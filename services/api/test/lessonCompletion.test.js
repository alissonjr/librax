import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompletionEntry, parseGuestLog, LIMITS } from '../src/domain/lessonCompletion.js';

// Validacao das conclusoes que chegam do cliente (POST /v1/lesson/complete e
// POST /v1/guest/migrate). O cliente nao e confiavel: tudo e checado e limitado.

const catalog = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 10, signCount: 3 },
  },
  signsOrder: ['letra-A', 'letra-B', 'letra-C'],
  alphabetLessonId: 'u1-l2',
};
const ctx = { catalog, today: '2026-10-23' };

function entry(over = {}) {
  return {
    lessonAttemptId: '3f0c8a52-6b0e-4c1e-9d55-2a1f0b7c9e10',
    lessonId: 'u1-l1',
    today: '2026-10-20',
    score: 0.8,
    reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
    signsLearnedDelta: 2,
    ...over,
  };
}

// --- parseCompletionEntry ---

test('aceita uma conclusao valida e devolve so os campos conhecidos', () => {
  const r = parseCompletionEntry({ ...entry(), xp: 9999, userId: 'outro' }, ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.value).sort(), [
    'alphabetComplete', 'completedAt', 'lessonAttemptId', 'lessonId', 'reviewed', 'score', 'signsLearnedDelta', 'today',
  ]);
  assert.equal(r.value.lessonId, 'u1-l1');
  assert.equal(r.value.alphabetComplete, false);
});

test('lessonAttemptId e obrigatorio quando pedido e tem formato restrito', () => {
  assert.equal(parseCompletionEntry(entry({ lessonAttemptId: undefined }), ctx).error, 'BAD_ATTEMPT_ID');
  assert.equal(parseCompletionEntry(entry({ lessonAttemptId: 'curto' }), ctx).error, 'BAD_ATTEMPT_ID');
  assert.equal(parseCompletionEntry(entry({ lessonAttemptId: 'a'.repeat(65) }), ctx).error, 'BAD_ATTEMPT_ID');
  assert.equal(parseCompletionEntry(entry({ lessonAttemptId: 'x y z 1 2 3 4' }), ctx).error, 'BAD_ATTEMPT_ID');
  // opcional no endpoint legado
  const r = parseCompletionEntry(entry({ lessonAttemptId: undefined }), { ...ctx, requireAttemptId: false });
  assert.equal(r.ok, true);
  assert.equal(r.value.lessonAttemptId, null);
});

test('rejeita licao fora do catalogo', () => {
  assert.equal(parseCompletionEntry(entry({ lessonId: 'nope' }), ctx).error, 'UNKNOWN_LESSON');
  assert.equal(parseCompletionEntry(entry({ lessonId: '__proto__' }), ctx).error, 'UNKNOWN_LESSON');
});

test('rejeita data invalida, no futuro ou antiga demais', () => {
  assert.equal(parseCompletionEntry(entry({ today: '23/10/2026' }), ctx).error, 'BAD_DATE');
  assert.equal(parseCompletionEntry(entry({ today: '2026-02-31' }), ctx).error, 'BAD_DATE');
  // 1 dia de folga para fuso horario
  assert.equal(parseCompletionEntry(entry({ today: '2026-10-24' }), ctx).ok, true);
  assert.equal(parseCompletionEntry(entry({ today: '2026-10-25' }), ctx).error, 'DATE_OUT_OF_RANGE');
  assert.equal(parseCompletionEntry(entry({ today: '2025-10-01' }), ctx).error, 'DATE_OUT_OF_RANGE');
});

test('score precisa ser numero entre 0 e 1', () => {
  assert.equal(parseCompletionEntry(entry({ score: 1.5 }), ctx).error, 'BAD_SCORE');
  assert.equal(parseCompletionEntry(entry({ score: '1' }), ctx).error, 'BAD_SCORE');
  assert.equal(parseCompletionEntry(entry({ score: Number.NaN }), ctx).error, 'BAD_SCORE');
});

test('reviewed: so sinais do curso, estados conhecidos e tamanho limitado', () => {
  assert.equal(
    parseCompletionEntry(entry({ reviewed: [{ signId: 'inventado', result: { state: 'correct' } }] }), ctx).error,
    'BAD_REVIEWED',
  );
  assert.equal(
    parseCompletionEntry(entry({ reviewed: [{ signId: 'letra-A', result: { state: 'hack' } }] }), ctx).error,
    'BAD_REVIEWED',
  );
  const many = Array.from({ length: LIMITS.maxReviewed + 1 }, () => ({ signId: 'letra-A', result: { state: 'failed' } }));
  assert.equal(parseCompletionEntry(entry({ reviewed: many }), ctx).error, 'BAD_REVIEWED');
  // normaliza: so signId e result.state/highConfidence
  const r = parseCompletionEntry(
    entry({ reviewed: [{ signId: 'letra-B', extra: 1, result: { state: 'correct', highConfidence: 1, x: 2 } }] }),
    ctx,
  );
  assert.deepEqual(r.value.reviewed, [{ signId: 'letra-B', result: { state: 'correct', highConfidence: true } }]);
});

test('signsLearnedDelta e limitado pela quantidade de sinais da licao', () => {
  assert.equal(parseCompletionEntry(entry({ signsLearnedDelta: 500 }), ctx).value.signsLearnedDelta, 2);
  assert.equal(parseCompletionEntry(entry({ signsLearnedDelta: -3 }), ctx).value.signsLearnedDelta, 0);
  assert.equal(parseCompletionEntry(entry({ signsLearnedDelta: 'x' }), ctx).value.signsLearnedDelta, 0);
});

test('alphabetComplete vem do catalogo, nao do cliente', () => {
  assert.equal(parseCompletionEntry(entry({ alphabetComplete: true }), ctx).value.alphabetComplete, false);
  assert.equal(parseCompletionEntry(entry({ lessonId: 'u1-l2' }), ctx).value.alphabetComplete, true);
});

test('completedAt opcional precisa ser ISO', () => {
  assert.equal(parseCompletionEntry(entry({ completedAt: '2026-10-20T13:00:00.000Z' }), ctx).ok, true);
  assert.equal(parseCompletionEntry(entry({ completedAt: 'ontem' }), ctx).error, 'BAD_COMPLETED_AT');
});

// --- parseGuestLog ---

test('parseGuestLog exige objeto com entries nao vazia', () => {
  assert.throws(() => parseGuestLog(null, ctx), /BAD_PAYLOAD/);
  assert.throws(() => parseGuestLog({ entries: 'x' }, ctx), /BAD_PAYLOAD/);
  assert.throws(() => parseGuestLog({ entries: [] }, ctx), /EMPTY_LOG/);
});

test('parseGuestLog limita o numero de conclusoes por envio', () => {
  const entries = Array.from({ length: LIMITS.maxEntries + 1 }, () => entry());
  assert.throws(() => parseGuestLog({ entries }, ctx), /TOO_MANY_ENTRIES/);
});

test('parseGuestLog separa invalidas e ordena as validas por dia e horario', () => {
  const { valid, rejected } = parseGuestLog(
    {
      entries: [
        entry({ lessonAttemptId: 'attempt-0003', today: '2026-10-21' }),
        entry({ lessonAttemptId: 'attempt-0002', today: '2026-10-20', completedAt: '2026-10-20T15:00:00.000Z' }),
        entry({ lessonAttemptId: 'attempt-0001', today: '2026-10-20', completedAt: '2026-10-20T09:00:00.000Z' }),
        entry({ lessonAttemptId: 'attempt-0004', lessonId: 'nope' }),
      ],
    },
    ctx,
  );
  assert.deepEqual(valid.map((e) => e.lessonAttemptId), ['attempt-0001', 'attempt-0002', 'attempt-0003']);
  assert.deepEqual(rejected, [{ index: 3, lessonAttemptId: 'attempt-0004', reason: 'UNKNOWN_LESSON' }]);
});
