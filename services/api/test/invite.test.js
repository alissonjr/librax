import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  generateInviteCode,
  normalizeInviteCode,
  isValidInviteCode,
  INVITE_ALPHABET,
  INVITE_LENGTH,
} from '../src/domain/invite.js';

// SPEC 04 secao 2 (createSquad): codigo de 6 chars, maiusculo, case-insensitive.

test('codigo tem 6 caracteres, todos do alfabeto', () => {
  const code = generateInviteCode(seqRng([0.0, 0.5, 0.99, 0.1, 0.7, 0.3]));
  assert.equal(code.length, INVITE_LENGTH);
  for (const ch of code) assert.ok(INVITE_ALPHABET.includes(ch), `char fora do alfabeto: ${ch}`);
});

test('geracao e deterministica dada a fonte de aleatoriedade', () => {
  const rngA = seqRng([0, 0, 0, 0, 0, 0]);
  const rngB = seqRng([0, 0, 0, 0, 0, 0]);
  assert.equal(generateInviteCode(rngA), generateInviteCode(rngB));
  // indice 0 -> primeiro char do alfabeto, repetido 6x
  assert.equal(generateInviteCode(seqRng([0, 0, 0, 0, 0, 0])), INVITE_ALPHABET[0].repeat(6));
});

test('normalizeInviteCode: trim + maiusculo (case-insensitive)', () => {
  assert.equal(normalizeInviteCode('  abc234 '), 'ABC234');
});

test('isValidInviteCode aceita codigo normalizado valido e rejeita o resto', () => {
  const valid = INVITE_ALPHABET.slice(0, 6);
  assert.equal(isValidInviteCode(valid.toLowerCase()), true);
  assert.equal(isValidInviteCode('ABC'), false); // curto
  assert.equal(isValidInviteCode('ABC23!'), false); // char invalido
});

// pequeno gerador deterministico [0,1)
function seqRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}
