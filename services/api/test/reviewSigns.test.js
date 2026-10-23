import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reviewSigns, reviewSignsOnce } from '../src/usecases/reviewSigns.js';
import { getDailyQueue } from '../src/usecases/getDailyQueue.js';
import { parsePracticeReview } from '../src/domain/practiceReview.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Pratica diaria (SPEC 03 secoes 6 e 11.12): cada resposta da revisao atualiza o SRS do sinal
// pelo SM-2. XP e ofensiva continuam ligados a conclusao de licao (SPEC 02 secao 5).

const today = '2026-10-23';
const correct = { state: 'correct', highConfidence: true };
const failed = { state: 'failed' };

async function repoWithDue() {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1', streak: 3, lastActiveDay: '2026-10-22', xpTotal: 40 });
  // terceira revisao: reps 2, intervalo 3, devido hoje
  await repo.saveSrsItem('u1', 'sinal-PAI', { ef: 2.5, reps: 2, interval: 3, dueAt: today });
  return repo;
}

test('acerto: sobe ef e reps e agenda para hoje + round(intervalo * ef)', async () => {
  const repo = await repoWithDue();

  const r = await reviewSigns(repo, { userId: 'u1', today, reviewed: [{ signId: 'sinal-PAI', result: correct }] });

  const item = await repo.getSrsItem('u1', 'sinal-PAI');
  assert.equal(r.srsUpdated, 1);
  assert.equal(item.reps, 3);
  assert.ok(Math.abs(item.ef - 2.6) < 1e-9);
  assert.equal(item.interval, 8); // round(3 * 2.6)
  assert.equal(item.dueAt, '2026-10-31');
  assert.deepEqual(r.items, [{ signId: 'sinal-PAI', ...item }]);
});

test('erro: recomeca o ciclo e o sinal volta amanha, com ef preservado', async () => {
  const repo = await repoWithDue();

  await reviewSigns(repo, { userId: 'u1', today, reviewed: [{ signId: 'sinal-PAI', result: failed }] });

  const item = await repo.getSrsItem('u1', 'sinal-PAI');
  assert.equal(item.reps, 0);
  assert.equal(item.interval, 1);
  assert.equal(item.ef, 2.5);
  assert.equal(item.dueAt, '2026-10-24');
});

test('sinal novo ganha item e no_capture nao cria nada', async () => {
  const repo = new InMemoryRepo();

  const r = await reviewSigns(repo, {
    userId: 'u1',
    today,
    reviewed: [
      { signId: 'sinal-MAE', result: correct },
      { signId: 'sinal-TIO', result: { state: 'no_capture' } },
    ],
  });

  assert.equal(r.srsUpdated, 1);
  assert.equal((await repo.getSrsItem('u1', 'sinal-MAE')).dueAt, '2026-10-24');
  assert.equal(await repo.getSrsItem('u1', 'sinal-TIO'), null);
});

test('nao concede XP nem mexe na ofensiva', async () => {
  const repo = await repoWithDue();

  await reviewSigns(repo, { userId: 'u1', today, reviewed: [{ signId: 'sinal-PAI', result: correct }] });

  const p = await repo.getProfile('u1');
  assert.equal(p.xpTotal, 40);
  assert.equal(p.streak, 3);
  assert.equal(p.lastActiveDay, '2026-10-22');
  assert.equal(await repo.getDayXp('u1', today), 0);
});

test('fila do dia: acertado sai de hoje e volta na data calculada; errado volta amanha', async () => {
  const repo = await repoWithDue();
  await repo.saveSrsItem('u1', 'sinal-MAE', { ef: 2.5, reps: 2, interval: 3, dueAt: today });
  const content = { signsOrder: ['sinal-PAI', 'sinal-MAE'] };
  const queue = async (day) => (await getDailyQueue(repo, content, { userId: 'u1', today: day })).map((q) => q.signId);

  assert.deepEqual((await queue(today)).sort(), ['sinal-MAE', 'sinal-PAI']);

  await reviewSigns(repo, { userId: 'u1', today, reviewed: [{ signId: 'sinal-PAI', result: correct }] });
  await reviewSigns(repo, { userId: 'u1', today, reviewed: [{ signId: 'sinal-MAE', result: failed }] });

  assert.deepEqual(await queue(today), []);
  assert.deepEqual(await queue('2026-10-24'), ['sinal-MAE']);
  assert.deepEqual((await queue('2026-10-31')).sort(), ['sinal-MAE', 'sinal-PAI']);
});

test('reviewSignsOnce: o reenvio da mesma resposta nao avanca o SRS de novo', async () => {
  const repo = await repoWithDue();
  const input = { userId: 'u1', today, reviewAttemptId: 'review-0001', reviewed: [{ signId: 'sinal-PAI', result: correct }] };

  const r1 = await reviewSignsOnce(repo, input);
  const r2 = await reviewSignsOnce(repo, input);

  assert.equal(r1.duplicate, false);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.srsUpdated, 1);
  assert.equal((await repo.getSrsItem('u1', 'sinal-PAI')).reps, 3);
});

// --- validacao do que chega do cliente ---

const catalog = { signsOrder: ['sinal-PAI', 'sinal-MAE'] };

test('parsePracticeReview aceita resposta valida e so passa campos conhecidos', () => {
  const r = parsePracticeReview(
    { reviewAttemptId: 'review-0001', today, reviewed: [{ signId: 'sinal-PAI', result: { ...correct, extra: 1 } }], xp: 999 },
    { catalog, today },
  );
  assert.deepEqual(r, {
    ok: true,
    value: { reviewAttemptId: 'review-0001', today, reviewed: [{ signId: 'sinal-PAI', result: correct }] },
  });
});

test('parsePracticeReview recusa sinal fora do catalogo, lista vazia, data e id invalidos', () => {
  const base = { reviewAttemptId: 'review-0001', today, reviewed: [{ signId: 'sinal-PAI', result: correct }] };
  const check = (over) => parsePracticeReview({ ...base, ...over }, { catalog, today });
  assert.deepEqual(check({ reviewed: [{ signId: 'sinal-X', result: correct }] }), { ok: false, error: 'BAD_REVIEWED' });
  assert.deepEqual(check({ reviewed: [] }), { ok: false, error: 'BAD_REVIEWED' });
  assert.deepEqual(check({ reviewed: undefined }), { ok: false, error: 'BAD_REVIEWED' });
  assert.deepEqual(check({ today: '2026-02-31' }), { ok: false, error: 'BAD_DATE' });
  assert.deepEqual(check({ today: '2020-01-01' }), { ok: false, error: 'DATE_OUT_OF_RANGE' });
  assert.deepEqual(check({ reviewAttemptId: 'x y' }), { ok: false, error: 'BAD_ATTEMPT_ID' });
  assert.deepEqual(parsePracticeReview(null, { catalog, today }), { ok: false, error: 'NOT_OBJECT' });
});
