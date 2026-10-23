import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { catalogFromCourse } from '../src/content/catalogFromCourse.js';
import catalog from '../src/content/catalog.js';

// O servidor recalcula XP e conquistas a partir da DEFINICAO das licoes (SPEC 02 secao 5.2).
// O catalogo empacotado na Lambda e derivado do mesmo course.json que o app usa.

const course = {
  courseId: 'libras-a1',
  signsOrder: ['letra-A', 'letra-B', 'oi'],
  achievementRules: [{ code: 'PRIMEIRA_LICAO', type: 'lessons_completed', gte: 1 }],
  units: [
    {
      id: 'u1',
      lessons: [
        { id: 'u1-l1', xpReward: 10, signIds: ['letra-A'] },
        { id: 'u1-l2', xpReward: 15, signIds: ['letra-B', 'letra-A'] },
      ],
    },
    { id: 'u2', lessons: [{ id: 'u2-l1', signIds: ['oi'] }] },
  ],
};

test('catalogFromCourse mapeia licoes com xpReward e quantidade de sinais', () => {
  const c = catalogFromCourse(course);
  assert.equal(c.courseId, 'libras-a1');
  assert.deepEqual(c.lessons['u1-l1'], { id: 'u1-l1', xpReward: 10, signCount: 1 });
  assert.deepEqual(c.lessons['u1-l2'], { id: 'u1-l2', xpReward: 15, signCount: 2 });
  assert.equal(c.lessons['u2-l1'].xpReward, 10); // default do dominio (xpForLesson)
  assert.deepEqual(c.signsOrder, course.signsOrder);
  assert.deepEqual(c.achievementRules, course.achievementRules);
});

test('alfabeto completo = ultima licao da primeira unidade (mesma regra do app)', () => {
  assert.equal(catalogFromCourse(course).alphabetLessonId, 'u1-l2');
});

test('catalogo empacotado esta em dia com o course.json do app (rode npm run catalog)', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../../../apps/web-poc/src/assets/content/course.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(catalog, catalogFromCourse(raw));
});
