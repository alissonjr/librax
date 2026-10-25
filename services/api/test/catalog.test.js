import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { catalogFromCourse } from '../src/content/catalogFromCourse.js';
import catalog from '../src/content/catalog.js';
import contentStatus from '../src/content/contentStatus.js';
import { contentReportFromBundle, labelsFromReport } from '../src/content/contentReport.js';

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

test('glosas so dos sinais do curso: rotulos aceitos no desempenho da camera', () => {
  const signs = [
    { id: 'letra-A', gloss: 'A' },
    { id: 'oi', gloss: 'OI' },
    { id: 'fora-do-curso', gloss: 'FORA' },
  ];
  assert.deepEqual(catalogFromCourse(course, signs).signGlosses, { 'letra-A': 'A', oi: 'OI' });
  assert.deepEqual(catalogFromCourse(course).signGlosses, {});
});

test('alfabeto completo = ultima licao da primeira unidade (mesma regra do app)', () => {
  assert.equal(catalogFromCourse(course).alphabetLessonId, 'u1-l2');
});

test('catalogo empacotado esta em dia com o course.json e o signs.json do app (rode npm run catalog)', () => {
  const dir = new URL('../../../apps/web-poc/src/assets/content/', import.meta.url);
  const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  assert.deepEqual(catalog, catalogFromCourse(read('course.json'), read('signs.json')));
  // todo sinal do curso tem glosa, e id e glosa servem de nome de contador (`wrong:<id>:<glosa>`)
  assert.equal(Object.keys(catalog.signGlosses).length, catalog.signsOrder.length);
  for (const [id, gloss] of Object.entries(catalog.signGlosses)) {
    assert.doesNotMatch(id, /[:\s]/, id);
    assert.match(gloss, /^[\p{Lu}\p{N}_-]{1,40}$/u, id);
  }
});

// --- situacao do conteudo (painel de administracao) ---

test('contentReportFromBundle diz o que falta em cada sinal e soma por unidade', () => {
  const signs = [
    { id: 'letra-A', gloss: 'A', validated: true, video_url: 'https://x/a.mp4', avatar: { provider: 'vlibras' }, source: { name: 'INES', url: 'https://ines' } },
    { id: 'letra-B', gloss: 'B', validated: false, video_url: null, avatar: { provider: 'vlibras' } },
    { id: 'oi', gloss: 'OI', validated: false, video_url: null, status: 'rascunho' },
  ];
  const report = contentReportFromBundle({ ...course, title: 'A1' }, signs);
  assert.equal(report.totals.units, 2);
  assert.equal(report.totals.lessons, 3);
  assert.deepEqual(
    { signs: report.totals.signs, validated: report.totals.validated, withVideo: report.totals.withVideo, withAvatar: report.totals.withAvatar, withSource: report.totals.withSource },
    { signs: 3, validated: 1, withVideo: 1, withAvatar: 2, withSource: 1 },
  );
  const byId = Object.fromEntries(report.signs.map((s) => [s.id, s]));
  assert.deepEqual(byId['letra-A'].missing, []);
  assert.deepEqual(byId['letra-B'].missing, ['validated', 'video', 'source']);
  assert.deepEqual(byId.oi.missing, ['validated', 'video', 'avatar', 'source']);
  assert.equal(byId['letra-B'].lessonId, 'u1-l2'); // primeira licao que ensina o sinal
  assert.equal(byId.oi.unitId, 'u2');
  assert.deepEqual(report.units[0].lessons.map((l) => l.id), ['u1-l1', 'u1-l2']);
  assert.equal(report.units[0].validated, 1);

  const labels = labelsFromReport(report);
  assert.equal(labels.lessons['u2-l1'].unitId, 'u2');
  assert.equal(labels.signs.oi, 'OI');
});

test('situacao do conteudo empacotada esta em dia com o app (rode npm run catalog)', () => {
  const dir = new URL('../../../apps/web-poc/src/assets/content/', import.meta.url);
  const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
  const expected = contentReportFromBundle(read('course.json'), read('signs.json'));
  assert.deepEqual(contentStatus, expected);
  // o curso A1: 14 unidades e 255 sinais (o Ç entrou na U1)
  assert.equal(contentStatus.totals.units, 14);
  assert.equal(contentStatus.totals.signs, 255);
});
