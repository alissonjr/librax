import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildGlobalRanking, isListedInGlobalRanking, rankingXp, GLOBAL_RANKING_TOP } from '../src/domain/ranking.js';
import { getGlobalRanking } from '../src/usecases/globalRanking.js';
import { updateProfile } from '../src/usecases/profile.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { migrateGuest } from '../src/usecases/migrateGuest.js';
import { deleteAccount } from '../src/usecases/deleteAccount.js';
import { makeRankingHandlers } from '../src/handlers/ranking.js';
import * as rankingHandlers from '../src/handlers/ranking.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// GET /v1/ranking/global: ranking de todos os tempos pelo XP total do perfil, com posicao por
// competicao (empate divide a posicao), sem o id de ninguem e sem quem saiu dele.

const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
const thu43 = new Date('2026-10-22T15:00:00Z');

function event({ sub = 'u1' } = {}) {
  return { requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined } };
}
const parse = (res) => JSON.parse(res.body);

async function study(repo, userId, times = 1) {
  for (let i = 0; i < times; i++) {
    await completeLesson(repo, content, { userId, lessonId: 'u1-l1', today: '2026-10-22', score: 1, now: thu43.getTime() });
  }
}

const named = (repo, userId, displayName) =>
  updateProfile(repo, { userId, changes: { displayName }, nowMs: thu43.getTime() });

// --- dominio ---

test('buildGlobalRanking: empate divide a posicao e a seguinte pula (1, 2, 2, 4)', () => {
  const entries = [
    { userId: 'a', displayName: 'Ana', xp: 50 },
    { userId: 'b', displayName: null, xp: 30 },
    { userId: 'c', displayName: 'Caio', xp: 30 },
    { userId: 'd', xp: 10 },
  ];
  const r = buildGlobalRanking({ entries, viewerId: 'c', xp: 30, listed: true, above: 1 });
  assert.deepEqual(r.top, [
    { rank: 1, name: 'Ana', xp: 50, isYou: false },
    { rank: 2, name: null, xp: 30, isYou: false },
    { rank: 2, name: 'Caio', xp: 30, isYou: true },
    { rank: 4, name: null, xp: 10, isYou: false },
  ]);
  assert.deepEqual(r.you, { rank: 2, xp: 30, listed: true });
  assert.equal(JSON.stringify(r).includes('userId'), false);
});

test('buildGlobalRanking: fora do ranking, rank null', () => {
  const r = buildGlobalRanking({ entries: [], viewerId: 'a', xp: 40, listed: false, above: 0 });
  assert.deepEqual(r, { top: [], you: { rank: null, xp: 40, listed: false } });
});

test('isListedInGlobalRanking e rankingXp', () => {
  assert.equal(isListedInGlobalRanking({}), true);
  assert.equal(isListedInGlobalRanking({ showInGlobalRanking: true }), true);
  assert.equal(isListedInGlobalRanking({ showInGlobalRanking: false }), false);
  assert.equal(rankingXp(12.7), 12);
  assert.equal(rankingXp(-5), 0);
  assert.equal(rankingXp(undefined), 0);
  assert.equal(rankingXp(1e12), 9999999999);
});

// --- usecase ---

test('licao e PUT do perfil mantem a entrada; topo por XP com nome e "voce"', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1', 1);
  await study(repo, 'u2', 3);
  await study(repo, 'u3', 1);
  await named(repo, 'u2', 'Bia');

  const r = await getGlobalRanking(repo, { userId: 'u1' });
  assert.deepEqual(r.top, [
    { rank: 1, name: 'Bia', xp: 30, isYou: false },
    { rank: 2, name: null, xp: 10, isYou: true },
    { rank: 2, name: null, xp: 10, isYou: false },
  ]);
  assert.deepEqual(r.you, { rank: 2, xp: 10, listed: true });
});

test('quem sai do ranking some do topo e recebe rank null; a posicao dos outros acompanha', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1', 1);
  await study(repo, 'u2', 3);
  await updateProfile(repo, { userId: 'u2', changes: { showInGlobalRanking: false }, nowMs: thu43.getTime() });

  const r2 = await getGlobalRanking(repo, { userId: 'u2' });
  assert.deepEqual(r2.you, { rank: null, xp: 30, listed: false });
  assert.deepEqual(r2.top.map((t) => t.xp), [10]);

  // mais licoes nao poem de volta
  await study(repo, 'u2', 1);
  assert.equal(await repo.hasGlobalRankingEntry('u2'), false);
  assert.deepEqual((await getGlobalRanking(repo, { userId: 'u1' })).you, { rank: 1, xp: 10, listed: true });
});

test('perfil de antes do ranking ganha a entrada na primeira leitura (se nao saiu)', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', xpTotal: 70, displayName: 'Ana' });
  await repo.seedProfile({ userId: 'u2', xpTotal: 90, showInGlobalRanking: false });
  assert.equal(await repo.hasGlobalRankingEntry('u1'), false);

  const r = await getGlobalRanking(repo, { userId: 'u1' });
  assert.deepEqual(r.you, { rank: 1, xp: 70, listed: true });
  assert.deepEqual(r.top, [{ rank: 1, name: 'Ana', xp: 70, isYou: true }]);

  const r2 = await getGlobalRanking(repo, { userId: 'u2' });
  assert.deepEqual(r2.you, { rank: null, xp: 90, listed: false });
  assert.equal(await repo.hasGlobalRankingEntry('u2'), false);
});

test('sem perfil: fora do ranking, sem gravar nada', async () => {
  const repo = new InMemoryRepo();
  const r = await getGlobalRanking(repo, { userId: 'u9' });
  assert.deepEqual(r, { top: [], you: { rank: null, xp: 0, listed: false } });
  assert.equal(await repo.getProfile('u9'), null);
});

test('topo de 50; quem esta abaixo dele recebe a posicao pela contagem', async () => {
  const repo = new InMemoryRepo();
  for (let i = 0; i < 55; i++) await repo.seedProfile({ userId: `p${String(i).padStart(2, '0')}`, xpTotal: 1000 - i * 10 });
  await repo.seedProfile({ userId: 'u1', xpTotal: 5 });
  for (const p of repo._profiles.keys()) await repo.addGlobalRankingEntry(p);

  const r = await getGlobalRanking(repo, { userId: 'u1' });
  assert.equal(r.top.length, GLOBAL_RANKING_TOP);
  assert.equal(r.top[0].xp, 1000);
  assert.equal(r.top.some((t) => t.isYou), false);
  assert.deepEqual(r.you, { rank: 56, xp: 5, listed: true });
});

test('migracao do convidado soma no ranking global', async () => {
  const repo = new InMemoryRepo();
  const catalog = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 0 } }, signsOrder: [], achievementRules: [] };
  const entries = ['attempt-0001', 'attempt-0002'].map((lessonAttemptId) => ({
    lessonAttemptId, lessonId: 'u1-l1', today: '2026-10-22', score: 1, reviewed: [],
  }));
  const r = await migrateGuest(repo, catalog, { userId: 'u1', payload: { entries }, now: thu43 });
  assert.equal(r.summary.applied, 2);
  assert.equal(await repo.hasGlobalRankingEntry('u1'), true);
  assert.deepEqual((await getGlobalRanking(repo, { userId: 'u1' })).you, { rank: 1, xp: 20, listed: true });
});

test('exclusao de conta tira a pessoa do ranking global', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1', 2);
  await study(repo, 'u2', 1);
  await deleteAccount(repo, { userId: 'u1' });
  assert.equal(await repo.hasGlobalRankingEntry('u1'), false);
  const r = await getGlobalRanking(repo, { userId: 'u2' });
  assert.deepEqual(r.top, [{ rank: 1, name: null, xp: 10, isYou: true }]);
});

// --- handler ---

test('GET /v1/ranking/global exporta handler de producao e exige token', async () => {
  assert.equal(typeof rankingHandlers.getGlobalRankingHandler, 'function');
  const h = makeRankingHandlers({ repo: new InMemoryRepo() });
  assert.equal((await h.getGlobalRankingHandler(event({ sub: null }))).statusCode, 401);
});

test('GET /v1/ranking/global: 200 com top e you, sem ids', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1', 2);
  await study(repo, 'u2', 1);
  await named(repo, 'u1', 'Ana');
  const h = makeRankingHandlers({ repo });
  const res = await h.getGlobalRankingHandler(event({ sub: 'u2' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), {
    top: [
      { rank: 1, name: 'Ana', xp: 20, isYou: false },
      { rank: 2, name: null, xp: 10, isYou: true },
    ],
    you: { rank: 2, xp: 10, listed: true },
  });
  assert.equal(res.body.includes('u1'), false);
});
