import { test } from 'node:test';
import assert from 'node:assert/strict';

import { xpForLesson, isDailyGoalMet } from '../src/domain/xp.js';

// SPEC 02 secao 5.2: XP e calculado no servidor a partir da definicao da licao;
// o cliente nunca escreve XP direto. goal_met dispara ao atingir a meta diaria.

test('xpForLesson usa o xpReward da licao', () => {
  assert.equal(xpForLesson({ id: 'u1-l1', xpReward: 15 }), 15);
});

test('xpForLesson assume 10 quando a licao nao define', () => {
  assert.equal(xpForLesson({ id: 'u1-l1' }), 10);
});

test('xpForLesson ignora qualquer xp vindo do cliente (anti-burla)', () => {
  assert.equal(xpForLesson({ id: 'x', xpReward: 10, xp: 9999 }), 10);
});

test('isDailyGoalMet: true apenas quando ESTA conclusao cruza a meta', () => {
  assert.equal(isDailyGoalMet(0, 10, 20), false); // 10 ainda abaixo
  assert.equal(isDailyGoalMet(15, 10, 20), true); // 15 -> 25 cruzou
  assert.equal(isDailyGoalMet(18, 2, 20), true); // 18 -> 20 exato
  assert.equal(isDailyGoalMet(20, 10, 20), false); // ja tinha batido: nao reemite
});
