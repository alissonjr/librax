import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseCompletionEntry, parseGuestLog } from '../src/domain/lessonCompletion.js';
import { buildOverview, placementWrites } from '../src/domain/opsMetrics.js';
import { applyPlacementOnce } from '../src/usecases/placement.js';
import { completeLessonOnce } from '../src/usecases/completeLessonOnce.js';
import { migrateGuest } from '../src/usecases/migrateGuest.js';
import { accountSummary } from '../src/usecases/admin.js';
import { makeLessonHandlers } from '../src/handlers/lesson.js';
import { catalogFromCourse } from '../src/content/catalogFromCourse.js';
import bundled from '../src/content/catalog.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { DynamoRepo } from '../src/adapters/dynamoRepo.js';

// Teste de nivelamento (apps/web-poc/src/lib/placement.ts): a licao pulada chega pela fila de
// conclusoes com `placement: 'skip'` e o "Desfazer" com `placement: 'undo'`. So o progresso muda:
// sem XP, sem ofensiva, sem SRS, sem conquista e sem liga.

const catalog = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 10, signCount: 2 },
    'u3-l1': { id: 'u3-l1', xpReward: 10, signCount: 2 },
  },
  signsOrder: ['letra-A', 'letra-B'],
  alphabetLessonId: 'u1-l2',
  placementLessonIds: ['u1-l1', 'u1-l2'],
  achievementRules: [
    { code: 'PRIMEIRA_LICAO', type: 'lessons_completed', gte: 1 },
    { code: 'ALFABETO', type: 'alphabet_complete' },
  ],
  signGlosses: { 'letra-A': 'A', 'letra-B': 'B' },
};
const today = '2026-10-23';
const ctx = { catalog, today };
const now = () => new Date('2026-10-23T15:00:00Z');
const USER = 'u1';

const mark = (id, over = {}) => ({
  lessonAttemptId: id,
  lessonId: 'u1-l2',
  today: '2026-10-22',
  completedAt: '2026-10-22T10:00:00.000Z',
  placement: 'skip',
  ...over,
});

// --- validacao ---

test('marca do nivelamento: valida acao, id, licao coberta pelo teste e data', () => {
  const r = parseCompletionEntry(mark('attempt-0001'), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, {
    lessonAttemptId: 'attempt-0001', lessonId: 'u1-l2', today: '2026-10-22', completedAt: '2026-10-22T10:00:00.000Z', placement: 'skip',
  });
  // sem nota, sem alphabetComplete, sem sinais: nada que o completeLesson usaria
  assert.equal('score' in r.value, false);
  assert.equal('alphabetComplete' in r.value, false);

  const err = (over, c = ctx) => parseCompletionEntry(mark('attempt-0001', over), c).error;
  assert.equal(err({ placement: 'done' }), 'BAD_PLACEMENT');
  assert.equal(err({ placement: null }), 'BAD_PLACEMENT');
  assert.equal(err({ placement: true }), 'BAD_PLACEMENT');
  assert.equal(err({ lessonAttemptId: undefined }), 'BAD_ATTEMPT_ID');
  // id obrigatorio mesmo no endpoint que aceita cliente antigo sem id
  assert.equal(parseCompletionEntry({ ...mark('x'), lessonAttemptId: null }, { ...ctx, requireAttemptId: false }).error, 'BAD_ATTEMPT_ID');
  assert.equal(err({ lessonId: 'u9-l9' }), 'UNKNOWN_LESSON');
  assert.equal(err({ lessonId: 'u3-l1' }), 'NOT_PLACEMENT_LESSON');
  assert.equal(err({}, { ...ctx, catalog: { ...catalog, placementLessonIds: undefined } }), 'NOT_PLACEMENT_LESSON');
  assert.equal(err({ today: '2026-02-31' }), 'BAD_DATE');
  assert.equal(err({ today: '2024-01-01' }), 'DATE_OUT_OF_RANGE');
  assert.equal(err({ completedAt: 'ontem' }), 'BAD_COMPLETED_AT');
  assert.equal(parseCompletionEntry(mark('attempt-0001', { placement: 'undo' }), ctx).value.placement, 'undo');
});

test('marca com nota ou sinais continua sendo so marca (o resto e ignorado)', () => {
  const r = parseCompletionEntry(mark('attempt-0001', { score: 1, signsLearnedDelta: 5, reviewed: [{ signId: 'letra-A' }] }), ctx);
  assert.equal(r.ok, true);
  assert.equal(r.value.placement, 'skip');
  assert.equal('score' in r.value || 'reviewed' in r.value || 'signsLearnedDelta' in r.value, false);
});

test('log do convidado ordena marcas e conclusoes juntas, pelo dia e horario', () => {
  const { valid, rejected } = parseGuestLog({
    entries: [
      mark('attempt-0002', { placement: 'undo', today: '2026-10-22', completedAt: '2026-10-22T12:00:00.000Z' }),
      mark('attempt-0001'),
      mark('attempt-0003', { lessonId: 'u3-l1' }),
    ],
  }, ctx);
  assert.deepEqual(valid.map((e) => [e.lessonAttemptId, e.placement]), [['attempt-0001', 'skip'], ['attempt-0002', 'undo']]);
  assert.deepEqual(rejected.map((r) => r.reason), ['NOT_PLACEMENT_LESSON']);
});

// --- usecase ---

test('pular nao da XP, ofensiva, SRS, conquista nem liga, e o reenvio nao conta de novo', async () => {
  const repo = new InMemoryRepo();
  const input = { userId: USER, ...mark('attempt-0001', { today }) };

  const r1 = await applyPlacementOnce(repo, input);
  assert.deepEqual(r1, { placement: 'skip', lessonId: 'u1-l2', changed: true, xpAwarded: 0, lessonAttemptId: 'attempt-0001', duplicate: false });
  assert.deepEqual(await repo.getProgress(USER, 'u1-l2'), { skippedAt: today, status: 'placement' });

  const r2 = await applyPlacementOnce(repo, input);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.changed, true); // o resultado guardado

  assert.equal(await repo.getProfile(USER), null);
  assert.equal(await repo.getDayXp(USER, today), 0);
  assert.deepEqual(await repo.listEarnedAchievements(USER), []);
  assert.deepEqual(await repo.listSrsItems(USER), []);
  assert.equal(await repo.getUserLeague(USER), null);
  assert.equal(await repo.getActivity(USER), null, 'pular nao conta a pessoa como ativa');
  const lesson = await repo.getOpsItem(`DAY#${today}#LESSON`);
  assert.equal(lesson['placement:u1-l2'], 1);
  assert.equal(await repo.getOpsItem(`DAY#${today}`), null, 'nem licao concluida no total do dia');
});

test('marca nunca cobre conclusao de verdade, e a conclusao substitui a marca', async () => {
  const repo = new InMemoryRepo();
  await completeLessonOnce(repo, catalog, { userId: USER, lessonAttemptId: 'attempt-real-1', lessonId: 'u1-l1', today, score: 0.9, reviewed: [] });
  const r = await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { lessonId: 'u1-l1', today }) });
  assert.equal(r.changed, false);
  assert.equal((await repo.getProgress(USER, 'u1-l1')).status, 'completed');
  assert.equal((await repo.getOpsItem(`DAY#${today}#LESSON`))['placement:u1-l1'], undefined);

  // pulada e refeita: vira conclusao normal, com XP e "alfabeto completo" (a ultima da U1)
  await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0002', { today }) });
  const done = await completeLessonOnce(repo, catalog, {
    userId: USER, lessonAttemptId: 'attempt-real-2', lessonId: 'u1-l2', today, score: 1, reviewed: [], alphabetComplete: true,
  });
  assert.equal(done.xpAwarded, 10);
  assert.equal((await repo.getProgress(USER, 'u1-l2')).status, 'completed');
  assert.ok(done.achievementsEarned.includes('ALFABETO'));
});

test('pular a ultima licao do alfabeto nao da a conquista', async () => {
  const repo = new InMemoryRepo();
  await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { today }) });
  assert.equal(await repo.getProfile(USER), null);
  assert.deepEqual(await repo.listEarnedAchievements(USER), []);
});

test('desfazer apaga so as marcas que nao foram refeitas', async () => {
  const repo = new InMemoryRepo();
  await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { lessonId: 'u1-l1', today }) });
  await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0002', { lessonId: 'u1-l2', today }) });
  await completeLessonOnce(repo, catalog, { userId: USER, lessonAttemptId: 'attempt-real-1', lessonId: 'u1-l2', today, score: 1, reviewed: [] });

  const undo1 = await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0003', { lessonId: 'u1-l1', today, placement: 'undo' }) });
  const undo2 = await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0004', { lessonId: 'u1-l2', today, placement: 'undo' }) });
  assert.equal(undo1.changed, true);
  assert.equal(undo2.changed, false);
  assert.equal(await repo.getProgress(USER, 'u1-l1'), null);
  assert.equal((await repo.getProgress(USER, 'u1-l2')).status, 'completed');
  const lesson = await repo.getOpsItem(`DAY#${today}#LESSON`);
  assert.equal(lesson['placementUndo:u1-l1'], 1);
  assert.equal(lesson['placementUndo:u1-l2'], undefined);
});

test('falha ao gravar libera a tentativa para o reenvio', async () => {
  const repo = new InMemoryRepo();
  const original = repo.markPlacementSkip.bind(repo);
  repo.markPlacementSkip = async () => { throw new Error('rede'); };
  await assert.rejects(() => applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { today }) }));
  repo.markPlacementSkip = original;
  assert.equal((await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { today }) })).duplicate, false);
});

// --- bordas HTTP e migracao ---

test('POST /v1/lesson/complete com placement grava a marca, sem XP', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const call = (body) => completeLessonHandler({ requestContext: { authorizer: { jwt: { claims: { sub: USER } } } }, body: JSON.stringify(body) });

  const res = await call(mark('attempt-0001'));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).xpAwarded, 0);
  assert.equal((await repo.getProgress(USER, 'u1-l2')).status, 'placement');
  assert.equal(await repo.getProfile(USER), null);

  assert.equal(JSON.parse((await call(mark('attempt-0001'))).body).duplicate, true);
  const bad = await call(mark('attempt-0002', { lessonId: 'u3-l1' }));
  assert.equal(bad.statusCode, 400);
  assert.equal(JSON.parse(bad.body).error.code, 'NOT_PLACEMENT_LESSON');
});

test('migracao do convidado aplica marcas e conclusoes na ordem, sem XP pelas marcas', async () => {
  const repo = new InMemoryRepo();
  const out = await migrateGuest(repo, catalog, {
    userId: USER,
    now: new Date('2026-10-23T12:00:00Z'),
    payload: {
      entries: [
        mark('attempt-0001', { lessonId: 'u1-l1', completedAt: '2026-10-22T10:00:00.000Z' }),
        mark('attempt-0002', { lessonId: 'u1-l2', completedAt: '2026-10-22T10:00:01.000Z' }),
        { lessonAttemptId: 'attempt-0003', lessonId: 'u1-l2', today: '2026-10-22', completedAt: '2026-10-22T11:00:00.000Z', score: 1, reviewed: [] },
        mark('attempt-0004', { lessonId: 'u1-l1', placement: 'undo', completedAt: '2026-10-22T12:00:00.000Z' }),
        mark('attempt-0005', { lessonId: 'u1-l2', placement: 'undo', completedAt: '2026-10-22T12:00:00.000Z' }),
      ],
    },
  });
  assert.deepEqual(out.summary, { applied: 5, duplicate: 0, rejected: 0 });
  assert.equal(out.profile.xpTotal, 10, 'so a licao refeita da XP');
  assert.equal(await repo.getProgress(USER, 'u1-l1'), null);
  assert.equal((await repo.getProgress(USER, 'u1-l2')).status, 'completed');
});

// --- painel ---

test('painel: puladas e desfeitas por licao na tela de operacao', () => {
  const writes = placementWrites({ lessonId: 'u1-l3', today, placement: 'skip' });
  assert.deepEqual(writes.map((w) => [w.key, w.counters]), [[`DAY#${today}#LESSON`, { 'placement:u1-l3': 1 }]]);
  const undo = placementWrites({ lessonId: 'u1-l3', today, placement: 'undo' });
  assert.deepEqual(undo[0].counters, { 'placementUndo:u1-l3': 1 });

  const overview = buildOverview({
    today,
    dayItems: [{ key: `DAY#${today}#LESSON`, 'placement:u1-l3': 4, 'placementUndo:u1-l3': 1, 'done:u1-l1': 2 }],
  });
  const row = overview.lessons.find((l) => l.lessonId === 'u1-l3');
  assert.equal(row.placementSkips, 4);
  assert.equal(row.placementUndos, 1);
  assert.equal(row.done, 0);
  assert.equal(overview.lessons.find((l) => l.lessonId === 'u1-l1').placementSkips, 0);
});

test('painel: resumo da conta mostra a licao pulada pelo nivelamento', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: USER });
  await repo.saveProgress(USER, 'u1-l1', { status: 'completed', bestScore: 1, completedAt: '2026-10-20' });
  await applyPlacementOnce(repo, { userId: USER, ...mark('attempt-0001', { today: '2026-10-21' }) });
  const directory = { get: async () => null };
  const s = await accountSummary(repo, directory, { userId: USER, now: now() });
  assert.equal(s.progress.distinctLessons, 1);
  assert.equal(s.progress.placementSkipped, 1);
  assert.deepEqual(s.progress.lessons.map((l) => [l.lessonId, l.status, l.skippedAt]), [
    ['u1-l2', 'placement', '2026-10-21'],
    ['u1-l1', 'completed', null],
  ]);
});

// --- DynamoDB e catalogo ---

function fakeClient(responder = () => ({})) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      return responder(cmd.constructor.name, cmd.input);
    },
  };
}
const conditionFailed = () => {
  const err = new Error('condicao');
  err.name = 'ConditionalCheckFailedException';
  throw err;
};

test('DynamoRepo: marca e desfaz com escrita condicional em PROG#<licao>', async () => {
  const db = fakeClient();
  const repo = new DynamoRepo(db);
  assert.equal(await repo.markPlacementSkip(USER, 'u1-l2', { skippedAt: today }), true);
  assert.equal(await repo.clearPlacementSkip(USER, 'u1-l2'), true);
  const [put, del] = db.calls;
  assert.equal(put.name, 'PutCommand');
  assert.deepEqual(put.input.Item, { PK: 'USER#u1', SK: 'PROG#u1-l2', skippedAt: today, status: 'placement' });
  assert.equal(put.input.ConditionExpression, 'attribute_not_exists(PK)');
  assert.equal(del.name, 'DeleteCommand');
  assert.deepEqual(del.input.Key, { PK: 'USER#u1', SK: 'PROG#u1-l2' });
  assert.equal(del.input.ConditionExpression, '#status = :placement');
  assert.deepEqual(del.input.ExpressionAttributeValues, { ':placement': 'placement' });

  const refused = new DynamoRepo(fakeClient(conditionFailed));
  assert.equal(await refused.markPlacementSkip(USER, 'u1-l2', {}), false);
  assert.equal(await refused.clearPlacementSkip(USER, 'u1-l2'), false);
});

test('catalogo: o teste de nivelamento cobre as unidades 1 e 2', () => {
  const course = {
    units: [
      { id: 'u1', lessons: [{ id: 'u1-l1', signIds: [] }, { id: 'u1-l2', signIds: [] }] },
      { id: 'u2', lessons: [{ id: 'u2-l1', signIds: [] }] },
      { id: 'u3', lessons: [{ id: 'u3-l1', signIds: [] }] },
    ],
  };
  assert.deepEqual(catalogFromCourse(course).placementLessonIds, ['u1-l1', 'u1-l2', 'u2-l1']);
  assert.ok(bundled.placementLessonIds.includes(bundled.alphabetLessonId));
  assert.ok(bundled.placementLessonIds.every((id) => /^u[12]-/.test(id)));
});
