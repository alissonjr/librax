import { test } from 'node:test';
import assert from 'node:assert/strict';

import { completeLesson } from '../src/usecases/completeLesson.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// SPEC 02 (Definicao de pronto): completeLesson = XP + streak + SRS + conquistas,
// + fan-out de XP para squads (SPEC 04 secao 1.4). Orquestra o dominio sobre o repo.

const content = {
  lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } },
  achievementRules: [
    { code: 'first_lesson', type: 'lessons_completed', gte: 1 },
    { code: 'streak_7', type: 'streak', gte: 7 },
  ],
};

function baseInput(over = {}) {
  return { userId: 'u1', lessonId: 'u1-l1', score: 1, today: '2026-06-27', reviewed: [], ...over };
}

test('concede XP, atualiza streak e registra o dia', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', dailyGoalXp: 20 });

  const r = await completeLesson(repo, content, baseInput());

  assert.equal(r.xpAwarded, 10);
  const p = await repo.getProfile('u1');
  assert.equal(p.xpTotal, 10);
  assert.equal(p.streak, 1);
  assert.equal(p.lastActiveDay, '2026-06-27');
  assert.equal(r.goalMet, false); // 10 < 20
});

test('emite goal_met apenas ao cruzar a meta diaria', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', dailyGoalXp: 20 });

  const r1 = await completeLesson(repo, content, baseInput()); // dia: 0 -> 10
  const r2 = await completeLesson(repo, content, baseInput()); // dia: 10 -> 20

  assert.equal(r1.goalMet, false);
  assert.equal(r2.goalMet, true);
});

test('atualiza SRS dos sinais revisados e ignora no_capture', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1' });

  const r = await completeLesson(
    repo,
    content,
    baseInput({
      reviewed: [
        { signId: 'letra-A', result: { state: 'correct', highConfidence: true } },
        { signId: 'letra-B', result: { state: 'no_capture' } },
      ],
    }),
  );

  assert.equal(r.srsUpdated, 1);
  assert.equal((await repo.getSrsItem('u1', 'letra-A')).reps, 1);
  assert.equal(await repo.getSrsItem('u1', 'letra-B'), null); // no_capture nao cria item
});

test('concede conquistas e e idempotente entre licoes', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', streak: 6, lastActiveDay: '2026-06-26' });

  const r = await completeLesson(repo, content, baseInput()); // streak 6->7
  assert.deepEqual(r.achievementsEarned.sort(), ['first_lesson', 'streak_7']);

  const r2 = await completeLesson(repo, content, baseInput({ today: '2026-06-28' }));
  assert.deepEqual(r2.achievementsEarned, []);
});

test('faz fan-out de XP para as squads do usuario', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1' });
  await repo.seedSquad('s1', { type: 'public' });
  await repo.addSquadMember('s1', 'u1');

  await completeLesson(repo, content, baseInput());

  const squad = await repo.getSquad('s1');
  assert.equal(squad.xpWeekly, 10);
  assert.equal(await repo.getSquadMemberXp('s1', 'u1'), 10);
});

test('cliente nao injeta XP: usa a definicao da licao (anti-burla)', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1' });

  const r = await completeLesson(repo, content, baseInput({ xp: 9999 }));
  assert.equal(r.xpAwarded, 10);
});

test('licao desconhecida e rejeitada', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1' });
  await assert.rejects(() => completeLesson(repo, content, baseInput({ lessonId: 'nope' })));
});

test('cria perfil default se o usuario ainda nao tem (convidado)', async () => {
  const repo = new InMemoryRepo();
  const r = await completeLesson(repo, content, baseInput({ userId: 'guest1' }));
  assert.equal(r.xpAwarded, 10);
  assert.equal((await repo.getProfile('guest1')).xpTotal, 10);
});
