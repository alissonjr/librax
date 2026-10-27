import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completeLessonOnce } from '../src/usecases/completeLessonOnce.js';
import { applyPlacementOnce } from '../src/usecases/placement.js';
import { exportProgress } from '../src/usecases/exportProgress.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { makeProgressHandlers } from '../src/handlers/progress.js';
import * as progressHandlers from '../src/handlers/progress.js';

// GET /v1/users/me/progress: quem entra numa conta (comeco do app, aparelho novo) recebe o
// progresso que o servidor guarda, para o app gravar no aparelho.

const content = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 15, signCount: 2 },
    'u1-l3': { id: 'u1-l3', xpReward: 15, signCount: 2 },
  },
  signsOrder: ['letra-A', 'letra-B'],
  alphabetLessonId: 'u1-l2',
  achievementRules: [{ code: 'PRIMEIRA_LICAO', type: 'lessons_completed', gte: 1 }],
};

async function setup() {
  const repo = new InMemoryRepo();
  await completeLessonOnce(repo, content, {
    userId: 'u1',
    lessonAttemptId: 'attempt-0001',
    lessonId: 'u1-l1',
    today: '2026-10-20',
    score: 0.9,
    reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
    signsLearnedDelta: 1,
    now: new Date('2026-10-20T12:00:00Z').getTime(),
  });
  await applyPlacementOnce(repo, { userId: 'u1', lessonAttemptId: 'attempt-0002', lessonId: 'u1-l2', today: '2026-10-21', placement: 'skip' });
  return repo;
}

test('o handler de producao existe (nada de import indefinido)', () => {
  assert.equal(typeof progressHandlers.getProgressHandler, 'function');
});

test('exportProgress: licoes concluidas e puladas, revisoes, XP por dia, conquistas e o perfil', async () => {
  const repo = await setup();
  const out = await exportProgress(repo, { userId: 'u1' });

  assert.equal(out.profile.xpTotal > 0, true);
  assert.equal(out.profile.streak, 1);
  assert.equal(out.profile.lastActiveDay, '2026-10-20');
  assert.equal(out.profile.lessonsCompleted, 1);
  assert.equal('dailyGoalXp' in out.profile, false); // a meta so existe no aparelho

  const byId = Object.fromEntries(out.lessons.map((l) => [l.lessonId, l]));
  assert.deepEqual(byId['u1-l1'], { lessonId: 'u1-l1', status: 'completed', bestScore: 0.9, completedAt: '2026-10-20' });
  assert.deepEqual(byId['u1-l2'], { lessonId: 'u1-l2', status: 'placement', completedAt: '2026-10-21' });

  assert.deepEqual(out.srs.map((s) => s.signId), ['letra-A']);
  assert.equal(out.srs[0].userId, undefined);
  assert.deepEqual(out.days, [{ day: '2026-10-20', xp: out.profile.xpTotal }]);
  assert.deepEqual(out.achievements, ['PRIMEIRA_LICAO']);
});

test('exportProgress: conta sem nada devolve tudo vazio e o nome do token', async () => {
  const out = await exportProgress(new InMemoryRepo(), { userId: 'nova', name: '  Ana  ' });
  assert.equal(out.profile.displayName, 'Ana');
  assert.equal(out.profile.xpTotal, 0);
  assert.deepEqual([out.lessons, out.srs, out.days, out.achievements], [[], [], [], []]);
});

test('exportProgress: o nome do perfil vem antes do token; nome vazio vira null', async () => {
  const repo = new InMemoryRepo();
  await repo.saveProfile({ userId: 'u1', displayName: 'Bia' });
  assert.equal((await exportProgress(repo, { userId: 'u1', name: 'Outra' })).profile.displayName, 'Bia');
  assert.equal((await exportProgress(new InMemoryRepo(), { userId: 'x', name: '   ' })).profile.displayName, null);
});

const ev = (claims) => ({ requestContext: { authorizer: claims ? { jwt: { claims } } : undefined } });

test('GET /v1/users/me/progress: so o progresso do sub do token; sem token 401', async () => {
  const repo = await setup();
  const h = makeProgressHandlers({ repo });

  const res = await h.getProgressHandler(ev({ sub: 'u1', given_name: 'Caio', name: 'Caio Souza' }));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.profile.displayName, 'Caio');
  assert.equal(body.lessons.length, 2);

  const other = JSON.parse((await h.getProgressHandler(ev({ sub: 'u2', name: 'Davi Lima' }))).body);
  assert.deepEqual(other.lessons, []);
  assert.equal(other.profile.displayName, 'Davi Lima');

  assert.equal((await h.getProgressHandler(ev(null))).statusCode, 401);
});
