import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateAchievements } from '../src/domain/achievements.js';

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
