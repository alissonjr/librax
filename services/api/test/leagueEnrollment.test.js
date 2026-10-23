import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { closeLeagueWeek } from '../src/usecases/closeLeagueWeek.js';
import { ensureLeague, placeInLeague } from '../src/usecases/leagueEnrollment.js';
import { LEAGUE_SIZE } from '../src/domain/leagues.js';

// Entrada na liga pelo servidor (SPEC 02 secao 5.5): na primeira licao da semana a pessoa
// entra na liga certa, num grupo de ate 30, sem depender do app.

const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
const W43 = Date.parse('2026-10-19T00:00:00Z');
const W44 = Date.parse('2026-10-26T00:00:00Z');
const thu43 = Date.parse('2026-10-22T15:00:00Z');
const mon44 = Date.parse('2026-10-26T10:00:00Z');
const closedAt = '2026-10-26T00:05:00.000Z';

const lesson = (userId, nowMs, today = new Date(nowMs).toISOString().slice(0, 10)) =>
  ({ userId, lessonId: 'u1-l1', today, score: 1, now: nowMs });

const ouroW43 = { leagueId: 'ouro-2026-w43', tier: 'ouro', period: '2026-w43', periodStart: '2026-10-19' };

async function seedLeague(repo, l, n, prefix = 'u') {
  for (let i = 0; i < n; i++) {
    const userId = `${prefix}${String(i + 1).padStart(2, '0')}`;
    await repo.joinLeague(l, userId);
    await repo.incrementLeagueXp(l.leagueId, userId, (n - i) * 10);
  }
}

test('quem e novo entra na Bronze da semana na primeira licao e o XP soma nela', async () => {
  const repo = new InMemoryRepo();
  const r = await completeLesson(repo, content, lesson('novo', thu43));

  assert.equal(r.leagueId, 'bronze-2026-w43');
  assert.deepEqual(await repo.getLeaguePlacement('novo', '2026-w43'), {
    leagueId: 'bronze-2026-w43', tier: 'bronze', period: '2026-w43',
  });
  assert.equal(await repo.getLeagueMemberXp('bronze-2026-w43', 'novo'), 10);
  assert.equal((await repo.getLeague('bronze-2026-w43')).status, 'open');

  // a segunda licao da semana nao troca de liga
  await completeLesson(repo, content, lesson('novo', thu43 + 3600_000));
  assert.equal(await repo.getLeagueMemberXp('bronze-2026-w43', 'novo'), 20);
  assert.equal((await repo.getLeague('bronze-2026-w43')).memberCount, 1);
});

test('quem tem resultado de semana anterior entra na liga de destino', async () => {
  const repo = new InMemoryRepo();
  await repo.applyLeagueResult('volta', {
    userId: 'volta', xp: 0, rank: 20, total: 30, outcome: 'stayed', fromTier: 'rubi', toTier: 'rubi',
    leagueId: 'rubi-2026-w40', period: '2026-w40', periodStart: '2026-09-28',
  });

  const r = await completeLesson(repo, content, lesson('volta', mon44));

  assert.equal(r.leagueId, 'rubi-2026-w44');
  assert.equal(await repo.getLeagueMemberXp('rubi-2026-w44', 'volta'), 10);
});

test('quem ja foi levado pelo fechamento semanal fica onde esta', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, { ...ouroW43, leagueId: 'ouro-2026-w43-g2', group: 2 }, 30);
  await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  const r = await completeLesson(repo, content, lesson('u01', mon44));

  assert.equal(r.leagueId, 'safira-2026-w44-g2');
  assert.equal(await repo.getLeagueMemberXp('safira-2026-w44-g2', 'u01'), 10);
});

test('fechamento ainda nao rodou: a licao fecha a semana so para a pessoa e o job depois concorda', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);

  const r = await completeLesson(repo, content, lesson('u01', Date.parse('2026-10-26T00:01:00Z')));

  assert.equal(r.leagueId, 'safira-2026-w44'); // u01 foi o primeiro da Ouro
  const state = await repo.getLeagueState('u01');
  assert.equal(state.lastResult.outcome, 'promoted');
  assert.equal(state.lastClosedPeriod, '2026-w43');

  const report = await closeLeagueWeek(repo, { periodStart: W43, closedAt });
  assert.equal(report.alreadyApplied, 1);
  assert.equal((await repo.getLeaguePlacement('u01', '2026-w44')).leagueId, 'safira-2026-w44');
  assert.equal((await repo.getLeague('safira-2026-w44')).memberCount, 3); // u01 nao conta duas vezes
  assert.equal(await repo.getLeagueMemberXp('safira-2026-w44', 'u01'), 10);
});

test('grupos de ate 30 com sufixo -g<n>, mesmo com entradas concorrentes', async () => {
  const repo = new InMemoryRepo();
  const users = Array.from({ length: 2 * LEAGUE_SIZE + 5 }, (_, i) => `c${String(i).padStart(2, '0')}`);

  const placed = await Promise.all(users.map((userId) => ensureLeague(repo, { userId, nowMs: thu43 })));

  const sizes = {};
  for (const p of placed) sizes[p.leagueId] = (sizes[p.leagueId] ?? 0) + 1;
  assert.deepEqual(sizes, { 'bronze-2026-w43': 30, 'bronze-2026-w43-g2': 30, 'bronze-2026-w43-g3': 5 });
  for (const id of Object.keys(sizes)) {
    assert.equal((await repo.getLeague(id)).memberCount, sizes[id], id);
    assert.equal((await repo.listLeagueMembers(id)).length, sizes[id], id);
  }
  assert.equal((await repo.getLeague('bronze-2026-w43-g2')).group, 2);

  // repetir para as mesmas pessoas nao muda nada
  const again = await Promise.all(users.map((userId) => ensureLeague(repo, { userId, nowMs: thu43 })));
  assert.deepEqual(again.map((p) => p.leagueId), placed.map((p) => p.leagueId));
  assert.equal((await repo.getLeague('bronze-2026-w43')).memberCount, 30);
});

test('placeInLeague: grupo preferido cheio vai para o proximo com vaga', async () => {
  const repo = new InMemoryRepo();
  for (let i = 0; i < LEAGUE_SIZE; i++) {
    await placeInLeague(repo, { userId: `p${i}`, tier: 'prata', periodStart: W44, preferGroup: 2 });
  }
  const extra = await placeInLeague(repo, { userId: 'extra', tier: 'prata', periodStart: W44, preferGroup: 2 });

  assert.equal(extra.leagueId, 'prata-2026-w44'); // g1 ainda tinha vaga
  assert.equal((await repo.getLeague('prata-2026-w44-g2')).memberCount, 30);
});

test('o fechamento nao estoura 30 por grupo ao levar gente para a semana seguinte', async () => {
  const repo = new InMemoryRepo();
  // Bronze: 27 ficam; Prata: 10 descem para a Bronze. Mesmo grupo daria 37.
  await seedLeague(repo, { leagueId: 'bronze-2026-w43', tier: 'bronze', period: '2026-w43', periodStart: '2026-10-19' }, 30, 'b');
  await seedLeague(repo, { leagueId: 'prata-2026-w43', tier: 'prata', period: '2026-w43', periodStart: '2026-10-19' }, 30, 'p');

  await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  assert.equal((await repo.getLeague('bronze-2026-w44')).memberCount, 30);
  assert.equal((await repo.getLeague('bronze-2026-w44-g2')).memberCount, 7);
});

test('licao de outra semana (migracao ou fila antiga) nao entra na liga atual', async () => {
  const repo = new InMemoryRepo();
  const r = await completeLesson(repo, content, lesson('velho', thu43, '2026-09-01'));

  assert.equal(r.leagueId, null);
  assert.equal(await repo.getLeaguePlacement('velho', '2026-w43'), null);
  assert.equal((await repo.getProfile('velho')).xpTotal, 10); // o XP do perfil continua valendo
});

test('domingo a noite no Brasil (segunda cedo em UTC) ainda conta na semana nova', async () => {
  const repo = new InMemoryRepo();
  const r = await completeLesson(repo, content, lesson('br', Date.parse('2026-10-26T01:00:00Z'), '2026-10-25'));
  assert.equal(r.leagueId, 'bronze-2026-w44');
});
