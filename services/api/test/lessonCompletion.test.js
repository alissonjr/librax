import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompletionEntry, parseGuestLog, parseCameraStats, LIMITS, CAMERA_LIMITS } from '../src/domain/lessonCompletion.js';

// Validacao das conclusoes que chegam do cliente (POST /v1/lesson/complete e
// POST /v1/guest/migrate). O cliente nao e confiavel: tudo e checado e limitado.

const catalog = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 10, signCount: 3 },
  },
  signsOrder: ['letra-A', 'letra-B', 'letra-C'],
  alphabetLessonId: 'u1-l2',
  signGlosses: { 'letra-A': 'A', 'letra-B': 'B', 'letra-C': 'C' },
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

// --- exerciseStats (telemetria do painel de administracao) ---

test('exerciseStats valido passa e o invalido some sem recusar a conclusao', () => {
  const ok = parseCompletionEntry(entry({ exerciseStats: { mc4: { attempted: 1, wrong: 0 } } }), ctx);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.exerciseStats, undefined); // tipo desconhecido: telemetria descartada

  const r = parseCompletionEntry(entry({
    exerciseStats: { watch_choose_word: { attempted: 3, wrong: 1 }, match_pairs: { attempted: 0, wrong: 0 } },
  }), ctx);
  assert.deepEqual(r.value.exerciseStats, { watch_choose_word: { attempted: 3, wrong: 1 } });

  for (const bad of [
    { perform_sign: { attempted: 1, wrong: 2 } },
    { perform_sign: { attempted: 101, wrong: 0 } },
    { perform_sign: { attempted: 1.5, wrong: 0 } },
    { perform_sign: 'muitos' },
    ['perform_sign'],
  ]) {
    const res = parseCompletionEntry(entry({ exerciseStats: bad }), ctx);
    assert.equal(res.ok, true);
    assert.equal(res.value.exerciseStats, undefined);
  }
});

// --- cameraStats (desempenho da camera, telemetria do painel de administracao) ---

test('cameraStats valido passa normalizado, com wrong vazio quando nao veio', () => {
  const r = parseCompletionEntry(entry({
    cameraStats: {
      'letra-A': { successes: 2, skips: 1, attempts: 5, wrong: { B: 2, C: 1 } },
      'letra-B': { successes: 0, skips: 1, attempts: 0 },
    },
  }), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.cameraStats, {
    'letra-A': { successes: 2, skips: 1, attempts: 5, wrong: { B: 2, C: 1 } },
    'letra-B': { successes: 0, skips: 1, attempts: 0, wrong: {} },
  });
  // sem o campo, nada muda na conclusao
  assert.equal(parseCompletionEntry(entry(), ctx).value.cameraStats, undefined);
});

test('cameraStats: sinal fora do formato some sozinho e a conclusao segue valendo', () => {
  const good = { successes: 1, skips: 0, attempts: 1 };
  for (const bad of [
    { successes: 1.5, skips: 0, attempts: 2 },
    { successes: -1, skips: 2, attempts: 0 },
    { successes: 0, skips: 0, attempts: 0 }, // nenhuma vez
    { successes: 2, skips: 0, attempts: 1 }, // menos tentativas que acertos
    { successes: 0, skips: 1, attempts: 3 }, // tentativa sem acerto
    { successes: CAMERA_LIMITS.maxRunsPerSign + 1, skips: 0, attempts: 60 },
    { successes: 1, skips: 0, attempts: CAMERA_LIMITS.maxCount + 1 },
    { successes: 1, skips: 0, attempts: 2, wrong: { B: 1.5 } },
    { successes: 1, skips: 0, attempts: 2, wrong: ['B'] },
    { successes: 1, skips: 0, attempts: 2, wrong: Object.fromEntries(Array.from({ length: CAMERA_LIMITS.maxWrongLabels + 1 }, (_, i) => [`X${i}`, 1])) },
    'muitos',
  ]) {
    const r = parseCompletionEntry(entry({ cameraStats: { 'letra-A': bad, 'letra-B': good } }), ctx);
    assert.equal(r.ok, true, JSON.stringify(bad));
    assert.deepEqual(Object.keys(r.value.cameraStats), ['letra-B'], JSON.stringify(bad));
  }
});

test('cameraStats: so sinais e rotulos do curso, sem texto livre', () => {
  const glosses = catalog.signGlosses;
  // sinal fora do catalogo some; rotulo desconhecido, minusculo ou o proprio sinal some do wrong
  assert.deepEqual(
    parseCameraStats({
      'nao-existe': { successes: 1, skips: 0, attempts: 1 },
      'letra-A': { successes: 1, skips: 0, attempts: 3, wrong: { B: 1, Z: 4, b: 1, A: 2, 'oi tudo bem': 1, C: 0 } },
    }, glosses),
    { 'letra-A': { successes: 1, skips: 0, attempts: 3, wrong: { B: 1 } } },
  );
  assert.equal(parseCameraStats({ 'nao-existe': { successes: 1, skips: 0, attempts: 1 } }, glosses), null);
  for (const bad of [null, 'x', [], 3]) assert.equal(parseCameraStats(bad, glosses), null);
  // envio com sinais demais e descartado inteiro
  const many = Object.fromEntries(Array.from({ length: CAMERA_LIMITS.maxSigns + 1 }, (_, i) => [`s${i}`, {}]));
  assert.equal(parseCameraStats({ ...many, 'letra-A': { successes: 1, skips: 0, attempts: 1 } }, glosses), null);
});

test('cameraStats chega pela migracao do convidado como pela conclusao', () => {
  const { valid } = parseGuestLog(
    { entries: [entry({ cameraStats: { 'letra-C': { successes: 1, skips: 0, attempts: 2, wrong: { A: 1 } } } })] },
    ctx,
  );
  assert.deepEqual(valid[0].cameraStats, { 'letra-C': { successes: 1, skips: 0, attempts: 2, wrong: { A: 1 } } });
});
