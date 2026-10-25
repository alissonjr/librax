import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';

import { evaluateAchievements } from '../src/domain/achievements.js';
import { parseCompletionEntry } from '../src/domain/lessonCompletion.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import catalog from '../src/content/catalog.js';

// SPEC 02 secao 5.4: regras declarativas avaliadas apos cada evento; idempotente.
const RULES = [
  { code: 'first_lesson', type: 'lessons_completed', gte: 1 },
  { code: 'streak_7', type: 'streak', gte: 7 },
  { code: 'signs_50', type: 'signs_learned', gte: 50 },
  { code: 'alphabet', type: 'alphabet_complete' },
];

test('concede conquistas cujo criterio foi atingido', () => {
  const newly = evaluateAchievements(
    RULES,
    { lessonsCompleted: 1, streak: 7, signsLearned: 10, alphabetComplete: false },
    [],
  );
  assert.deepEqual(newly.sort(), ['first_lesson', 'streak_7']);
});

test('idempotente: nao reconcede o que ja foi ganho', () => {
  const newly = evaluateAchievements(RULES, { streak: 30 }, ['streak_7']);
  assert.deepEqual(newly, []);
});

test('regra booleana (alphabet_complete)', () => {
  const newly = evaluateAchievements(RULES, { alphabetComplete: true }, []);
  assert.deepEqual(newly, ['alphabet']);
});

test('nao concede quando o criterio nao bate', () => {
  const newly = evaluateAchievements(RULES, { streak: 6, signsLearned: 49 }, []);
  assert.deepEqual(newly, []);
});

test('aceita earnedCodes como Set', () => {
  const newly = evaluateAchievements(RULES, { lessonsCompleted: 5 }, new Set(['first_lesson']));
  assert.deepEqual(newly, []);
});

test('tipo desconhecido falha alto (erro de configuracao de conteudo)', () => {
  assert.throws(() => evaluateAchievements([{ code: 'x', type: 'bogus' }], {}, []));
});

// --- Alfabeto completo (SINAIS_26) no catalogo do curso ---
// O codigo SINAIS_26 fica (ja esta gravado no perfil de quem ganhou), mas a regra deixou de ser
// "26 sinais quaisquer": vale ao concluir a licao que fecha o alfabeto (catalog.alphabetLessonId),
// a ultima da U1, que so abre depois das anteriores. A U1 ensina as 27 letras (A a Z e o Ç).

test('SINAIS_26 (Alfabeto completo) pede o alfabeto completo, nao 26 sinais quaisquer', () => {
  const rule = catalog.achievementRules.find((r) => r.code === 'SINAIS_26');
  assert.deepEqual(rule, { code: 'SINAIS_26', type: 'alphabet_complete' });

  const semAlfabeto = { streak: 0, lessonsCompleted: 30, signsLearned: 200, alphabetComplete: false };
  assert.ok(!evaluateAchievements(catalog.achievementRules, semAlfabeto, []).includes('SINAIS_26'));
  const comAlfabeto = { ...semAlfabeto, signsLearned: 27, alphabetComplete: true };
  assert.ok(evaluateAchievements(catalog.achievementRules, comAlfabeto, []).includes('SINAIS_26'));
});

test('a licao que completa o alfabeto fecha a U1, que ensina as 27 letras', () => {
  const course = JSON.parse(
    readFileSync(new URL('../../../apps/web-poc/src/assets/content/course.json', import.meta.url), 'utf8'),
  );
  const u1 = course.units[0].lessons;
  assert.equal(catalog.alphabetLessonId, u1[u1.length - 1].id);
  const letters = new Set(u1.flatMap((l) => l.signIds).filter((id) => id.startsWith('letra-')));
  assert.deepEqual([...letters].sort(), [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÇ'].map((l) => `letra-${l}`).sort());
});

test('concluir a licao do alfabeto concede SINAIS_26; mais de 26 sinais em outras licoes nao', async () => {
  const today = '2026-10-25';
  const finish = (repo, lessonId, signsLearnedDelta) => {
    const parsed = parseCompletionEntry(
      { lessonId, today, score: 1, reviewed: [], signsLearnedDelta },
      { catalog, today, requireAttemptId: false },
    );
    assert.equal(parsed.ok, true, parsed.error);
    return completeLesson(repo, catalog, { userId: 'u1', ...parsed.value });
  };

  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', signsLearned: 26 });
  const outra = await finish(repo, 'u2-l1', catalog.lessons['u2-l1'].signCount);
  assert.ok((await repo.getProfile('u1')).signsLearned > 26);
  assert.ok(!outra.achievementsEarned.includes('SINAIS_26'));

  const alfabeto = await finish(repo, catalog.alphabetLessonId, 0);
  assert.ok(alfabeto.achievementsEarned.includes('SINAIS_26'));
});
