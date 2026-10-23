import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completeLessonOnce } from '../src/usecases/completeLessonOnce.js';
import { migrateGuest } from '../src/usecases/migrateGuest.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Plano mobile web 3.6 e fase W3: o convidado joga 100% local; ao criar conta o app manda o
// log de conclusoes e o servidor reexecuta cada uma com o mesmo completeLesson.
// Idempotencia por lessonAttemptId: reenvio nao duplica XP, streak nem SRS.

const content = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 15, signCount: 2 },
  },
  signsOrder: ['letra-A', 'letra-B'],
  alphabetLessonId: 'u1-l2',
  achievementRules: [{ code: 'PRIMEIRA_LICAO', type: 'lessons_completed', gte: 1 }],
};
const now = new Date('2026-10-23T12:00:00Z');

function entry(id, over = {}) {
  return {
    lessonAttemptId: id,
    lessonId: 'u1-l1',
    today: '2026-10-20',
    score: 1,
    reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
    signsLearnedDelta: 1,
    ...over,
  };
}

const guestLog = () => ({
  entries: [
    entry('attempt-0002', { today: '2026-10-21', lessonId: 'u1-l2' }),
    entry('attempt-0001', { today: '2026-10-20' }),
    entry('attempt-0003', { today: '2026-10-22' }),
  ],
});

// --- completeLessonOnce ---

test('completeLessonOnce aplica uma vez e devolve duplicate no reenvio', async () => {
  const repo = new InMemoryRepo();
  const input = { userId: 'u1', lessonAttemptId: 'attempt-0001', lessonId: 'u1-l1', today: '2026-10-20', score: 1, reviewed: [] };

  const r1 = await completeLessonOnce(repo, content, input);
  const r2 = await completeLessonOnce(repo, content, input);

  assert.equal(r1.duplicate, false);
  assert.equal(r1.xpAwarded, 10);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.xpAwarded, 10); // devolve o resultado guardado
  assert.equal((await repo.getProfile('u1')).xpTotal, 10);
  assert.equal(await repo.getDayXp('u1', '2026-10-20'), 10);
});

test('completeLessonOnce libera a tentativa se o completeLesson falhar', async () => {
  const repo = new InMemoryRepo();
  const input = { userId: 'u1', lessonAttemptId: 'attempt-0009', lessonId: 'nope', today: '2026-10-20', score: 1, reviewed: [] };
  await assert.rejects(() => completeLessonOnce(repo, content, input));
  assert.equal(await repo.getLessonAttempt('u1', 'attempt-0009'), null);
});

test('mesma tentativa em usuarios diferentes nao colide', async () => {
  const repo = new InMemoryRepo();
  const base = { lessonAttemptId: 'attempt-0001', lessonId: 'u1-l1', today: '2026-10-20', score: 1, reviewed: [] };
  await completeLessonOnce(repo, content, { ...base, userId: 'u1' });
  const r = await completeLessonOnce(repo, content, { ...base, userId: 'u2' });
  assert.equal(r.duplicate, false);
});

// --- migrateGuest ---

test('migra o log do convidado preservando XP, streak e SRS', async () => {
  const repo = new InMemoryRepo();
  const out = await migrateGuest(repo, content, { userId: 'u1', payload: guestLog(), now });

  assert.deepEqual(out.summary, { applied: 3, duplicate: 0, rejected: 0 });
  const p = await repo.getProfile('u1');
  assert.equal(p.xpTotal, 35);
  assert.equal(p.streak, 3); // 20, 21, 22 em ordem, mesmo enviados fora de ordem
  assert.equal(p.lastActiveDay, '2026-10-22');
  assert.equal(p.lessonsCompleted, 3);
  assert.equal(p.alphabetComplete, true); // u1-l2 e a ultima da U1 no catalogo
  assert.equal((await repo.getSrsItem('u1', 'letra-A')).reps, 3);
  assert.deepEqual(out.profile, { xpTotal: 35, streak: 3 });
});

test('reenvio do mesmo log nao duplica XP, streak nem SRS', async () => {
  const repo = new InMemoryRepo();
  await migrateGuest(repo, content, { userId: 'u1', payload: guestLog(), now });
  const before = await repo.getProfile('u1');
  const srsBefore = await repo.getSrsItem('u1', 'letra-A');

  const out = await migrateGuest(repo, content, { userId: 'u1', payload: guestLog(), now });

  assert.deepEqual(out.summary, { applied: 0, duplicate: 3, rejected: 0 });
  assert.deepEqual(await repo.getProfile('u1'), before);
  assert.deepEqual(await repo.getSrsItem('u1', 'letra-A'), srsBefore);
});

test('reenvio parcial: so as novas sao aplicadas', async () => {
  const repo = new InMemoryRepo();
  await migrateGuest(repo, content, { userId: 'u1', payload: { entries: [entry('attempt-0001')] }, now });
  const out = await migrateGuest(repo, content, { userId: 'u1', payload: guestLog(), now });
  assert.deepEqual(out.summary, { applied: 2, duplicate: 1, rejected: 0 });
  assert.equal((await repo.getProfile('u1')).xpTotal, 35);
});

test('tentativa repetida no mesmo envio conta uma vez so', async () => {
  const repo = new InMemoryRepo();
  const out = await migrateGuest(repo, content, {
    userId: 'u1',
    payload: { entries: [entry('attempt-0001'), entry('attempt-0001')] },
    now,
  });
  assert.deepEqual(out.summary, { applied: 1, duplicate: 1, rejected: 0 });
  assert.equal((await repo.getProfile('u1')).xpTotal, 10);
});

test('conclusoes invalidas sao rejeitadas sem impedir as validas', async () => {
  const repo = new InMemoryRepo();
  const out = await migrateGuest(repo, content, {
    userId: 'u1',
    payload: { entries: [entry('attempt-0001'), entry('attempt-0002', { score: 7 })] },
    now,
  });
  assert.deepEqual(out.summary, { applied: 1, duplicate: 0, rejected: 1 });
  const rejected = out.results.find((r) => r.status === 'rejected');
  assert.deepEqual(rejected, { lessonAttemptId: 'attempt-0002', status: 'rejected', reason: 'BAD_SCORE' });
});

test('mescla com conta que ja tinha progresso (login em conta existente)', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', xpTotal: 100, streak: 5, lastActiveDay: '2026-10-22' });
  await migrateGuest(repo, content, { userId: 'u1', payload: { entries: [entry('attempt-0001')] }, now });
  const p = await repo.getProfile('u1');
  assert.equal(p.xpTotal, 110);
  assert.equal(p.streak, 5); // dia antigo nao mexe na ofensiva atual
  assert.equal(p.lastActiveDay, '2026-10-22');
});
