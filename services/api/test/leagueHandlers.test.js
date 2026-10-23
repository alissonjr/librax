import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeLeagueHandlers } from '../src/handlers/league.js';
import * as leagueHandlers from '../src/handlers/league.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { closeLeagueWeek } from '../src/usecases/closeLeagueWeek.js';

// GET /v1/league/current e POST /v1/league/result-seen: a liga da semana no formato que a
// LeagueScreen usa (LeagueView de apps/web-poc/src/lib/leagueLocal.ts), com o ranking, o tempo
// ate o fechamento e o resultado da semana anterior ainda nao visto.

const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
const thu43 = new Date('2026-10-22T15:00:00Z');
const W43 = Date.parse('2026-10-19T00:00:00Z');
const W44 = Date.parse('2026-10-26T00:00:00Z');

function event({ sub = 'u1', body } = {}) {
  return {
    requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const parse = (res) => JSON.parse(res.body);

async function study(repo, userId, times, at = thu43) {
  for (let i = 0; i < times; i++) {
    await completeLesson(repo, content, { userId, lessonId: 'u1-l1', today: '2026-10-22', score: 1, now: at.getTime() });
  }
}

test('as duas rotas exportam handler de producao', () => {
  assert.equal(typeof leagueHandlers.getCurrentLeagueHandler, 'function');
  assert.equal(typeof leagueHandlers.markLeagueResultSeenHandler, 'function');
});

test('league/current exige usuario autenticado', async () => {
  const h = makeLeagueHandlers({ repo: new InMemoryRepo(), now: () => thu43 });
  assert.equal((await h.getCurrentLeagueHandler(event({ sub: null }))).statusCode, 401);
  assert.equal((await h.markLeagueResultSeenHandler(event({ sub: null, body: {} }))).statusCode, 401);
});

test('league/current: ranking da liga da semana no formato da LeagueView', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u2', displayName: 'Bia' });
  await study(repo, 'u1', 1);
  await study(repo, 'u2', 3);
  const h = makeLeagueHandlers({ repo, now: () => thu43 });

  const res = await h.getCurrentLeagueHandler(event());
  assert.equal(res.statusCode, 200);
  const view = parse(res);

  assert.equal(view.mode, 'server');
  assert.equal(view.enrolled, true);
  assert.equal(view.tier, 'bronze');
  assert.equal(view.leagueId, 'bronze-2026-w43');
  assert.equal(view.week, 43);
  assert.equal(view.period, '2026-w43');
  assert.equal(view.periodStart, W43);
  assert.equal(view.periodEnd, W44);
  assert.equal(view.msUntilClose, W44 - thu43.getTime());
  assert.equal(view.promote, 3);
  assert.equal(view.relegate, 0); // Bronze nao rebaixa
  assert.deepEqual(view.rows, [
    { userId: 'u2', name: 'Bia', xpPeriod: 30, rank: 1, zone: 'promotion', isYou: false, simulated: false },
    { userId: 'u1', name: null, xpPeriod: 10, rank: 2, zone: 'promotion', isYou: true, simulated: false },
  ]);
  assert.deepEqual(view.you, view.rows[1]);
  assert.equal(view.pendingResult, null);
});

test('league/current sem licao na semana: sem liga, mas com a liga em que vai entrar', async () => {
  const h = makeLeagueHandlers({ repo: new InMemoryRepo(), now: () => thu43 });
  const view = parse(await h.getCurrentLeagueHandler(event()));

  assert.equal(view.enrolled, false);
  assert.equal(view.tier, 'bronze');
  assert.equal(view.leagueId, null);
  assert.deepEqual(view.rows, []);
  assert.equal(view.you, null);
  assert.equal(view.pendingResult, null);
  assert.equal(view.periodEnd, W44);
});

test('resultado da semana anterior aparece ate ser marcado como visto', async () => {
  const repo = new InMemoryRepo();
  for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) await study(repo, u, u === 'u1' ? 5 : 1);
  await closeLeagueWeek(repo, { periodStart: W43, closedAt: '2026-10-26T00:05:00.000Z' });
  const mon = () => new Date('2026-10-26T12:00:00Z');
  const h = makeLeagueHandlers({ repo, now: mon });

  const view = parse(await h.getCurrentLeagueHandler(event()));
  assert.equal(view.enrolled, true); // levada pelo fechamento
  assert.equal(view.tier, 'prata');
  assert.equal(view.leagueId, 'prata-2026-w44');
  assert.deepEqual(view.pendingResult, {
    period: '2026-w43',
    periodStart: W43,
    leagueId: 'bronze-2026-w43',
    fromTier: 'bronze',
    toTier: 'prata',
    outcome: 'promoted',
    rank: 1,
    total: 5,
    xp: 50,
  });

  const seen = await h.markLeagueResultSeenHandler(event({ body: { period: '2026-w43' } }));
  assert.equal(seen.statusCode, 200);
  assert.deepEqual(parse(seen), { period: '2026-w43' });
  assert.equal(parse(await h.getCurrentLeagueHandler(event())).pendingResult, null);

  // marcar uma semana mais antiga depois nao faz o resultado voltar
  await h.markLeagueResultSeenHandler(event({ body: { period: '2026-w40' } }));
  assert.equal(parse(await h.getCurrentLeagueHandler(event())).pendingResult, null);
});

test('fechamento ainda nao rodou: a leitura ja mostra o resultado e a liga de destino, sem gravar', async () => {
  const repo = new InMemoryRepo();
  for (const u of ['u1', 'u2']) await study(repo, u, u === 'u1' ? 2 : 1);
  const h = makeLeagueHandlers({ repo, now: () => new Date('2026-10-26T00:01:00Z') });

  const view = parse(await h.getCurrentLeagueHandler(event()));

  assert.equal(view.enrolled, false);
  assert.equal(view.tier, 'prata');
  assert.equal(view.pendingResult.outcome, 'promoted');
  assert.equal(await repo.getLeagueState('u1'), null); // leitura nao grava
});

test('result-seen valida a semana', async () => {
  const h = makeLeagueHandlers({ repo: new InMemoryRepo(), now: () => thu43 });
  for (const body of [{}, { period: 'w43' }, { period: '2026-w43' }, { period: '2026-w50' }]) {
    const res = await h.markLeagueResultSeenHandler(event({ body }));
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(parse(res).error.code, 'INVALID_PERIOD');
  }
});
