import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyQueue } from '../src/domain/dailyQueue.js';
import { getDailyQueue } from '../src/usecases/getDailyQueue.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// SPEC 03 secao 6 / SPEC 02 secao 6: puxa SRS devidos (dueAt <= hoje), prioriza
// menor ef / maior atraso, e completa com conteudo novo ate o tamanho da licao.

test('prioriza menor ef primeiro', () => {
  const due = [
    { signId: 'A', ef: 2.5, dueAt: '2026-06-20' },
    { signId: 'B', ef: 1.6, dueAt: '2026-06-20' },
  ];
  const q = buildDailyQueue(due, [], { size: 10, today: '2026-06-27' });
  assert.deepEqual(q.map((x) => x.signId), ['B', 'A']);
  assert.equal(q[0].kind, 'review');
});

test('desempate de ef: o mais atrasado (dueAt mais antigo) primeiro', () => {
  const due = [
    { signId: 'A', ef: 2.0, dueAt: '2026-06-25' },
    { signId: 'B', ef: 2.0, dueAt: '2026-06-10' },
  ];
  const q = buildDailyQueue(due, [], { size: 10, today: '2026-06-27' });
  assert.deepEqual(q.map((x) => x.signId), ['B', 'A']);
});

test('exclui itens que ainda nao venceram', () => {
  const items = [
    { signId: 'A', ef: 2.0, dueAt: '2026-06-27' }, // vence hoje: entra
    { signId: 'B', ef: 2.0, dueAt: '2026-07-01' }, // futuro: fica de fora
  ];
  const q = buildDailyQueue(items, [], { size: 10, today: '2026-06-27' });
  assert.deepEqual(q.map((x) => x.signId), ['A']);
});

test('completa com conteudo novo ate o tamanho da licao', () => {
  const due = [{ signId: 'A', ef: 2.0, dueAt: '2026-06-20' }];
  const q = buildDailyQueue(due, ['X', 'Y', 'Z'], { size: 3, today: '2026-06-27' });
  assert.deepEqual(q.map((x) => x.signId), ['A', 'X', 'Y']);
  assert.equal(q[1].kind, 'new');
});

test('quando ha SRS devido demais, nao adiciona novos', () => {
  const due = [
    { signId: 'A', ef: 1.5, dueAt: '2026-06-20' },
    { signId: 'B', ef: 1.6, dueAt: '2026-06-20' },
    { signId: 'C', ef: 1.7, dueAt: '2026-06-20' },
  ];
  const q = buildDailyQueue(due, ['X'], { size: 2, today: '2026-06-27' });
  assert.equal(q.length, 2);
  assert.ok(q.every((x) => x.kind === 'review'));
});

test('usecase getDailyQueue: monta a fila a partir do repo + bundle de conteudo', async () => {
  const repo = new InMemoryRepo();
  await repo.saveSrsItem('u1', 'A', { ef: 2.5, reps: 2, interval: 3, dueAt: '2026-06-25' });
  await repo.saveSrsItem('u1', 'B', { ef: 1.6, reps: 1, interval: 1, dueAt: '2026-06-26' });
  await repo.saveSrsItem('u1', 'C', { ef: 2.0, reps: 5, interval: 30, dueAt: '2026-07-20' }); // nao devido

  const content = { signsOrder: ['A', 'B', 'C', 'D', 'E'] };
  const q = await getDailyQueue(repo, content, { userId: 'u1', today: '2026-06-27', size: 4 });

  // devidos por ef: B (1.6) depois A (2.5); novos nao aprendidos: D, E (C ja tem SRS)
  assert.deepEqual(q.map((x) => x.signId), ['B', 'A', 'D', 'E']);
  assert.deepEqual(q.map((x) => x.kind), ['review', 'review', 'new', 'new']);
});
