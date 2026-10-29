import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { closeLeagueWeek } from '../src/usecases/closeLeagueWeek.js';
import { completeLesson } from '../src/usecases/completeLesson.js';

// Fechamento semanal (SPEC 02 secao 5.5): percorre todas as ligas abertas da semana que
// terminou, pagina a pagina, e e idempotente (rodar de novo nao promove de novo).

const W43 = Date.parse('2026-10-19T00:00:00Z'); // semana que terminou
const closedAt = '2026-10-26T00:05:00.000Z';

const league = (tier, period, periodStart, group) => ({
  leagueId: `${tier}-${period}${group ? `-g${group}` : ''}`,
  tier,
  period,
  periodStart,
  ...(group ? { group } : {}),
});

/** Liga com `n` membros (u01 com mais XP); `zeros` ultimos ficam sem XP. */
async function seedLeague(repo, l, n, { prefix = 'u', zeros = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const userId = `${prefix}${String(i + 1).padStart(2, '0')}`;
    await repo.joinLeague(l, userId);
    if (i < n - zeros) await repo.incrementLeagueXp(l.leagueId, userId, (n - i) * 10);
  }
}

const ouroW43 = league('ouro', '2026-w43', '2026-10-19');
const bronzeW43 = league('bronze', '2026-w43', '2026-10-19');

test('fecha todas as ligas da semana, uma pagina por vez', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);
  await seedLeague(repo, bronzeW43, 12, { prefix: 'b' });
  await seedLeague(repo, league('prata', '2026-w43', '2026-10-19', 2), 5, { prefix: 'p' });
  await seedLeague(repo, league('ouro', '2026-w44', '2026-10-26'), 3, { prefix: 'x' }); // outra semana

  const report = await closeLeagueWeek(repo, { periodStart: W43, pageSize: 1, closedAt });

  assert.equal(report.period, '2026-w43');
  assert.equal(report.closed, 3);
  assert.equal(report.skipped, 0);
  assert.equal(report.pages, 3);
  assert.equal(report.members, 47);
  for (const id of ['ouro-2026-w43', 'bronze-2026-w43', 'prata-2026-w43-g2']) {
    assert.equal((await repo.getLeague(id)).status, 'closed', id);
  }
  assert.equal((await repo.getLeague('ouro-2026-w44')).status, 'open'); // semana atual intacta
});

test('promove, mantem e rebaixa para a liga certa da semana seguinte', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);

  await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  const top = await repo.getLeagueState('u01');
  assert.equal(top.tier, 'safira');
  assert.deepEqual(top.lastResult, {
    userId: 'u01',
    xp: 300,
    rank: 1,
    total: 30,
    outcome: 'promoted',
    fromTier: 'ouro',
    toTier: 'safira',
    leagueId: 'ouro-2026-w43',
    period: '2026-w43',
    periodStart: '2026-10-19',
  });
  assert.equal((await repo.getUserLeague('u01')).leagueId, 'safira-2026-w44');
  assert.equal((await repo.getUserLeague('u15')).leagueId, 'ouro-2026-w44');
  assert.equal((await repo.getUserLeague('u30')).leagueId, 'prata-2026-w44');
  assert.equal((await repo.getLeagueState('u30')).lastResult.outcome, 'relegated');

  // a liga nova nasce aberta, com XP zerado, e o XP da semana nova vai para ela
  const next = await repo.getLeague('safira-2026-w44');
  assert.equal(next.status, 'open');
  assert.equal(next.tier, 'safira');
  assert.equal(next.periodStart, '2026-10-26');
  assert.equal(await repo.getLeagueMemberXp('safira-2026-w44', 'u01'), 0);
});

test('o grupo da liga se mantem na semana seguinte', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, league('ouro', '2026-w43', '2026-10-19', 2), 30);
  await closeLeagueWeek(repo, { periodStart: W43, closedAt });
  assert.equal((await repo.getUserLeague('u01')).leagueId, 'safira-2026-w44-g2');
  assert.equal((await repo.getLeague('safira-2026-w44-g2')).group, 2);
});

test('Bronze nao rebaixa; quem nao fez XP fecha a semana mas nao e levado para a seguinte', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, bronzeW43, 12, { zeros: 2 });

  const report = await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  assert.equal(report.relegated, 0);
  assert.equal(report.carried, 10);
  const idle = await repo.getLeagueState('u12');
  assert.equal(idle.tier, 'bronze');
  assert.equal(idle.lastResult.outcome, 'stayed');
  assert.equal(idle.lastResult.xp, 0);
  // como no app: semana sem estudo nao gera rebaixamento extra nas semanas seguintes
  assert.equal((await repo.getUserLeague('u12')).leagueId, 'bronze-2026-w43');
  assert.deepEqual(
    (await repo.listLeagueMembers('bronze-2026-w44')).map((m) => m.userId).sort(),
    ['u04', 'u05', 'u06', 'u07', 'u08', 'u09', 'u10'], // u01 a u03 subiram para a Prata
  );
});

test('rodar duas vezes nao promove duas vezes nem zera o XP da semana nova', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);

  await closeLeagueWeek(repo, { periodStart: W43, closedAt });
  // u01 ja estudou na semana nova antes da segunda execucao
  await repo.incrementLeagueXp('safira-2026-w44', 'u01', 25);

  const second = await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  assert.equal(second.closed, 0);
  assert.equal(second.skipped, 1);
  assert.equal((await repo.getLeagueState('u01')).tier, 'safira'); // nao virou rubi
  assert.equal((await repo.getUserLeague('u01')).leagueId, 'safira-2026-w44');
  assert.equal(await repo.getLeagueMemberXp('safira-2026-w44', 'u01'), 25);
  assert.equal(await repo.getLeague('rubi-2026-w44'), null);
});

test('queda no meio da liga: a nova execucao completa sem aplicar duas vezes', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);
  const markClosed = repo.markLeagueClosed.bind(repo);
  let failures = 1;
  repo.markLeagueClosed = async (...args) => {
    if (failures-- > 0) throw new Error('timeout');
    return markClosed(...args);
  };

  await assert.rejects(() => closeLeagueWeek(repo, { periodStart: W43, closedAt }), /timeout/);
  assert.equal((await repo.getLeague('ouro-2026-w43')).status, 'open');

  const retry = await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  assert.equal(retry.closed, 1);
  assert.equal(retry.alreadyApplied, 30); // resultados ja gravados na 1a tentativa
  assert.equal((await repo.getLeagueState('u01')).tier, 'safira');
  assert.equal((await repo.getLeague('ouro-2026-w43')).status, 'closed');
});

test('liga sem membros fecha sem efeito', async () => {
  const repo = new InMemoryRepo();
  await repo.putLeague(ouroW43);
  const report = await closeLeagueWeek(repo, { periodStart: W43, closedAt });
  assert.equal(report.closed, 1);
  assert.equal(report.members, 0);
});

test('periodStart precisa ser uma segunda 00:00 UTC', async () => {
  await assert.rejects(
    () => closeLeagueWeek(new InMemoryRepo(), { periodStart: Date.parse('2026-10-21T00:00:00Z'), closedAt }),
    /INVALID_PERIOD/,
  );
});

test('depois do fechamento, a licao concluida soma XP na liga da semana nova', async () => {
  const repo = new InMemoryRepo();
  await seedLeague(repo, ouroW43, 30);
  await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
  await completeLesson(repo, content, { userId: 'u01', lessonId: 'u1-l1', today: '2026-10-26', score: 1 });

  assert.equal(await repo.getLeagueMemberXp('safira-2026-w44', 'u01'), 10);
  assert.equal(await repo.getLeagueMemberXp('ouro-2026-w43', 'u01'), 300);
});

test('quem segue para a semana seguinte leva o nome da liga que fechou', async () => {
  const repo = new InMemoryRepo();
  await repo.joinLeague(ouroW43, 'u01', { displayName: 'Ana' });
  await repo.joinLeague(ouroW43, 'u02');
  await repo.incrementLeagueXp(ouroW43.leagueId, 'u01', 50);
  await repo.incrementLeagueXp(ouroW43.leagueId, 'u02', 40);

  await closeLeagueWeek(repo, { periodStart: W43, closedAt });

  const { leagueId } = await repo.getUserLeague('u01');
  const names = Object.fromEntries((await repo.listLeagueMembers(leagueId)).map((m) => [m.userId, m.displayName ?? null]));
  assert.equal(names.u01, 'Ana');
  assert.equal(names.u02 ?? null, null);
  // o resultado gravado nao leva o nome
  assert.equal('displayName' in (await repo.getLeagueState('u01')).lastResult, false);
});
