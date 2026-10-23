import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyStreak } from '../src/domain/streak.js';

// Regras: SPEC 02 secao 5.1 (+ blueprint 02 secao 2.4).
// "Dia" no fuso do usuario: o chamador passa `today` ja como 'YYYY-MM-DD'
// no timezone do perfil; a funcao so faz aritmetica de datas e e pura.

test('primeiro dia: streak comeca em 1 e registra o dia', () => {
  const r = applyStreak({ streak: 0, lastActiveDay: null, freezes: 0 }, '2026-06-27');
  assert.equal(r.streak, 1);
  assert.equal(r.lastActiveDay, '2026-06-27');
  assert.equal(r.dayLogged, true);
  assert.equal(r.changed, true);
});

test('mesmo dia: no-op (nao conta de novo)', () => {
  const r = applyStreak({ streak: 5, lastActiveDay: '2026-06-27', freezes: 1 }, '2026-06-27');
  assert.equal(r.streak, 5);
  assert.equal(r.changed, false);
  assert.equal(r.dayLogged, false);
  assert.equal(r.freezes, 1);
});

test('dia consecutivo: incrementa', () => {
  const r = applyStreak({ streak: 5, lastActiveDay: '2026-06-26', freezes: 0 }, '2026-06-27');
  assert.equal(r.streak, 6);
  assert.equal(r.lastActiveDay, '2026-06-27');
  assert.equal(r.freezeConsumed, false);
});

test('quebrou (2 dias sem freeze): reseta para 1', () => {
  const r = applyStreak({ streak: 9, lastActiveDay: '2026-06-25', freezes: 0 }, '2026-06-27');
  assert.equal(r.streak, 1);
  assert.equal(r.freezeConsumed, false);
});

test('freeze cobre exatamente 1 dia perdido: mantem a sequencia e consome o freeze', () => {
  const r = applyStreak({ streak: 9, lastActiveDay: '2026-06-25', freezes: 1 }, '2026-06-27');
  assert.equal(r.streak, 10);
  assert.equal(r.freezes, 0);
  assert.equal(r.freezeConsumed, true);
});

test('freeze nao cobre 3+ dias perdidos: reseta para 1 e nao consome', () => {
  const r = applyStreak({ streak: 9, lastActiveDay: '2026-06-23', freezes: 1 }, '2026-06-27');
  assert.equal(r.streak, 1);
  assert.equal(r.freezes, 1);
  assert.equal(r.freezeConsumed, false);
});

test('vira o mes corretamente (consecutivo entre meses)', () => {
  const r = applyStreak({ streak: 3, lastActiveDay: '2026-05-31', freezes: 0 }, '2026-06-01');
  assert.equal(r.streak, 4);
});

test('e uma funcao pura: nao muta o input', () => {
  const input = { streak: 1, lastActiveDay: '2026-06-26', freezes: 0 };
  applyStreak(input, '2026-06-27');
  assert.equal(input.streak, 1);
  assert.equal(input.lastActiveDay, '2026-06-26');
});
