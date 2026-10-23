import { test } from 'node:test';
import assert from 'node:assert/strict';

import { updateSrs, qualityFromResult, newSrsItem } from '../src/domain/srs.js';

// SM-2 adaptado (SPEC 03 secao 6). Item por (usuario, sinal): ef, interval, reps, dueAt.

test('item novo: ef 2.5, reps 0, interval 0', () => {
  const it = newSrsItem();
  assert.equal(it.ef, 2.5);
  assert.equal(it.reps, 0);
  assert.equal(it.interval, 0);
});

test('erro (q<3): zera reps, revisa amanha, mantem ef', () => {
  const r = updateSrs({ ef: 2.5, reps: 4, interval: 20 }, 1, '2026-06-27');
  assert.equal(r.reps, 0);
  assert.equal(r.interval, 1);
  assert.equal(r.ef, 2.5);
  assert.equal(r.dueAt, '2026-06-28');
});

test('1a repeticao com sucesso: interval 1', () => {
  const r = updateSrs(newSrsItem(), 4, '2026-06-27');
  assert.equal(r.reps, 1);
  assert.equal(r.interval, 1);
  assert.equal(r.dueAt, '2026-06-28');
});

test('2a repeticao: interval 3', () => {
  const a = updateSrs(newSrsItem(), 4, '2026-06-27'); // due 06-28
  const r = updateSrs(a, 4, a.dueAt);
  assert.equal(r.reps, 2);
  assert.equal(r.interval, 3);
  assert.equal(r.dueAt, '2026-07-01');
});

test('3a repeticao: interval = round(interval_anterior * ef) com ef crescente em q=5', () => {
  let it = updateSrs(newSrsItem(), 5, '2026-06-27'); // ef2.6 reps1 int1 due06-28
  it = updateSrs(it, 5, it.dueAt);                   // ef2.7 reps2 int3 due07-01
  const r = updateSrs(it, 5, it.dueAt);              // ef2.8 reps3 int round(3*2.8)=8
  assert.equal(r.reps, 3);
  assert.ok(Math.abs(r.ef - 2.8) < 1e-9, `ef=${r.ef}`);
  assert.equal(r.interval, 8);
  assert.equal(r.dueAt, '2026-07-09');
});

test('ef tem piso de 1.3 mesmo apos varios q=3', () => {
  let it = newSrsItem();
  for (let i = 0; i < 20; i++) it = updateSrs(it, 3, '2026-06-27');
  assert.ok(it.ef >= 1.3, `ef=${it.ef}`);
});

test('qualityFromResult mapeia estados de avaliacao em q (SPEC 03 secao 6)', () => {
  assert.equal(qualityFromResult({ state: 'correct', highConfidence: true }), 5);
  assert.equal(qualityFromResult({ state: 'correct' }), 4);
  assert.equal(qualityFromResult({ state: 'accept_soft' }), 3);
  assert.equal(qualityFromResult({ state: 'retry_resolved' }), 2);
  assert.equal(qualityFromResult({ state: 'failed' }), 1);
  // no_capture nao e erro do aluno: nao gera sinal de SRS
  assert.equal(qualityFromResult({ state: 'no_capture' }), null);
});

test('updateSrs e puro: nao muta o item', () => {
  const it = { ef: 2.5, reps: 1, interval: 1 };
  updateSrs(it, 5, '2026-06-27');
  assert.equal(it.reps, 1);
  assert.equal(it.ef, 2.5);
});
