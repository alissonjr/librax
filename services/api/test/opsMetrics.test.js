import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  periodsOf,
  opsToday,
  opsExpiry,
  freshPeriods,
  lessonCompletedWrites,
  lessonAbandonWrites,
  newAccountWrites,
  buildOverview,
  cameraDifficulty,
  DAY_RETENTION_DAYS,
  CAMERA_WRITE_CHUNK,
} from '../src/domain/opsMetrics.js';
import { recordLessonCompleted, recordPractice } from '../src/usecases/opsMetrics.js';
import { completeLessonOnce } from '../src/usecases/completeLessonOnce.js';
import { reviewSignsOnce } from '../src/usecases/reviewSigns.js';
import { migrateGuest } from '../src/usecases/migrateGuest.js';
import { makeLessonHandlers } from '../src/handlers/lesson.js';
import { makePostConfirmationHandler } from '../src/handlers/postConfirmation.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { DynamoRepo } from '../src/adapters/dynamoRepo.js';

// Contadores agregados do painel de administracao: cada evento soma em poucos itens do dia e a
// tela le so esses itens (nunca um Scan na tabela).

const catalog = {
  lessons: {
    'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 2 },
    'u1-l2': { id: 'u1-l2', xpReward: 10, signCount: 2 },
  },
  signsOrder: ['letra-A', 'letra-B'],
  alphabetLessonId: 'u1-l2',
  achievementRules: [],
  signGlosses: { 'letra-A': 'A', 'letra-B': 'B' },
};
const failed = (signId) => ({ signId, result: { state: 'failed' } });
const right = (signId) => ({ signId, result: { state: 'correct' } });

function event({ sub = 'u1', body } = {}) {
  return {
    requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

// --- dominio ---

test('periodsOf: dia, semana ISO (a das ligas) e mes', () => {
  assert.deepEqual(periodsOf('2026-10-23'), { day: '2026-10-23', week: '2026-w43', month: '2026-10' });
  // domingo ainda e da semana que comecou na segunda
  assert.equal(periodsOf('2026-10-25').week, '2026-w43');
  assert.equal(periodsOf('2026-10-26').week, '2026-w44');
});

test('opsToday usa o dia de Brasilia: 01:00 UTC ainda e o dia anterior', () => {
  assert.equal(opsToday(new Date('2026-10-24T01:00:00Z')), '2026-10-23');
  assert.equal(opsToday(new Date('2026-10-24T03:30:00Z')), '2026-10-24');
});

test('TTL dos dias conta a partir do proprio dia', () => {
  const day = Date.UTC(2026, 9, 23) / 1000;
  assert.equal(opsExpiry('2026-10-23', DAY_RETENTION_DAYS), day + DAY_RETENTION_DAYS * 86400);
});

test('freshPeriods: so conta a pessoa uma vez por dia, semana e mes', () => {
  const p = periodsOf('2026-10-23');
  assert.deepEqual(freshPeriods(null, p), { day: true, week: true, month: true });
  assert.deepEqual(freshPeriods({ lastDay: '2026-10-22', lastWeek: '2026-w43', lastMonth: '2026-10' }, p), {
    day: true, week: false, month: false,
  });
  assert.deepEqual(freshPeriods({ lastDay: '2026-10-23', lastWeek: '2026-w43', lastMonth: '2026-10' }, p), {
    day: false, week: false, month: false,
  });
  // evento mais velho que o ultimo dia contado (relogio errado, fila antiga) nao conta
  assert.equal(freshPeriods({ lastDay: '2026-10-25' }, p).day, false);
});

test('licao concluida soma no dia, semana, mes, por licao, por exercicio e por sinal', () => {
  const writes = lessonCompletedWrites({
    lessonId: 'u1-l1',
    today: '2026-10-23',
    reviewed: [failed('letra-A'), right('letra-B'), { signId: 'letra-B', result: { state: 'no_capture' } }],
    exerciseStats: { watch_choose_word: { attempted: 3, wrong: 1 } },
    fresh: { day: true, week: false, month: false },
  });
  const byKey = Object.fromEntries(writes.map((w) => [w.key, w.counters]));
  assert.deepEqual(byKey['DAY#2026-10-23'], { lessonsCompleted: 1, activeUsers: 1 });
  assert.deepEqual(byKey['WEEK#2026-w43'], { lessonsCompleted: 1 });
  assert.deepEqual(byKey['MONTH#2026-10'], { lessonsCompleted: 1 });
  assert.deepEqual(byKey['DAY#2026-10-23#LESSON'], {
    'done:u1-l1': 1, 'attempted:u1-l1': 3, 'wrong:u1-l1': 1, 'reviewedSigns:u1-l1': 2, 'failedSigns:u1-l1': 1,
  });
  assert.deepEqual(byKey['DAY#2026-10-23#EXERCISE'], { 'attempted:watch_choose_word': 3, 'wrong:watch_choose_word': 1 });
  assert.deepEqual(byKey['DAY#2026-10-23#SIGN'], { 'failed:letra-A': 1 });
  // o mes nao expira; o dia expira em 400 dias
  assert.equal(writes.find((w) => w.key === 'MONTH#2026-10').expiresAt, null);
  assert.equal(writes.find((w) => w.key === 'DAY#2026-10-23').expiresAt, opsExpiry('2026-10-23', DAY_RETENTION_DAYS));
});

test('licao sem erro nem estatistica nao cria itens de sinal e exercicio', () => {
  const keys = lessonCompletedWrites({
    lessonId: 'u1-l1', today: '2026-10-23', reviewed: [right('letra-A')], fresh: { day: false, week: false, month: false },
  }).map((w) => w.key);
  assert.deepEqual(keys.sort(), ['DAY#2026-10-23', 'DAY#2026-10-23#LESSON', 'MONTH#2026-10', 'WEEK#2026-w43']);
});

test('desempenho da camera soma por sinal no item CAMERA do dia, sem identificar a pessoa', () => {
  const writes = lessonCompletedWrites({
    lessonId: 'u1-l1',
    today: '2026-10-23',
    cameraStats: {
      'letra-K': { successes: 1, skips: 1, attempts: 3, wrong: { H: 2 } },
      'letra-A': { successes: 1, skips: 0, attempts: 1, wrong: {} },
    },
    fresh: { day: false, week: false, month: false },
  });
  const camera = writes.filter((w) => w.key === 'DAY#2026-10-23#CAMERA');
  assert.equal(camera.length, 1);
  assert.deepEqual(camera[0].counters, {
    'success:letra-K': 1, 'skip:letra-K': 1, 'attempts:letra-K': 3, 'wrong:letra-K:H': 2,
    'success:letra-A': 1, 'attempts:letra-A': 1,
  });
  assert.equal(camera[0].expiresAt, opsExpiry('2026-10-23', DAY_RETENTION_DAYS));
});

test('licao com muitos sinais na camera divide o ADD (teto de 4 KB da expressao)', () => {
  const cameraStats = {};
  for (let i = 0; i < 40; i += 1) {
    cameraStats[`s${i}`] = { successes: 1, skips: 1, attempts: 2, wrong: { X: 1, Y: 1 } };
  }
  const camera = lessonCompletedWrites({ lessonId: 'u1-l1', today: '2026-10-23', cameraStats, fresh: { day: false, week: false, month: false } })
    .filter((w) => w.key === 'DAY#2026-10-23#CAMERA');
  assert.equal(camera.length, Math.ceil((40 * 5) / CAMERA_WRITE_CHUNK));
  for (const w of camera) assert.ok(Object.keys(w.counters).length <= CAMERA_WRITE_CHUNK);
  assert.equal(camera.reduce((acc, w) => acc + Object.keys(w.counters).length, 0), 200);
});

test('saida da licao soma por licao e pelo tipo do exercicio onde parou', () => {
  const writes = lessonAbandonWrites({
    lessonId: 'u1-l2', today: '2026-10-23', exerciseType: 'perform_sign', fresh: { day: false, week: false, month: false },
  });
  const byKey = Object.fromEntries(writes.map((w) => [w.key, w.counters]));
  assert.deepEqual(byKey['DAY#2026-10-23'], { lessonAbandons: 1 });
  assert.deepEqual(byKey['DAY#2026-10-23#LESSON'], { 'abandon:u1-l2': 1 });
  assert.deepEqual(byKey['DAY#2026-10-23#EXERCISE'], { 'abandon:perform_sign': 1 });
  assert.equal(byKey['WEEK#2026-w43'], undefined); // sem atividade nova, a semana nao muda
});

test('conta nova soma no dia, na semana e no mes', () => {
  assert.deepEqual(newAccountWrites({ day: '2026-10-23' }).map((w) => [w.key, w.counters.newAccounts]), [
    ['DAY#2026-10-23', 1], ['WEEK#2026-w43', 1], ['MONTH#2026-10', 1],
  ]);
});

// --- usecases sobre o repositorio ---

test('ativos: a mesma pessoa conta uma vez no dia, na semana e no mes', async () => {
  const repo = new InMemoryRepo();
  await recordLessonCompleted(repo, { userId: 'u1', lessonId: 'u1-l1', today: '2026-10-22' });
  await recordLessonCompleted(repo, { userId: 'u1', lessonId: 'u1-l2', today: '2026-10-22' });
  await recordPractice(repo, { userId: 'u1', today: '2026-10-23' });
  await recordLessonCompleted(repo, { userId: 'u2', lessonId: 'u1-l1', today: '2026-10-23' });

  assert.equal((await repo.getOpsItem('DAY#2026-10-22')).activeUsers, 1);
  assert.equal((await repo.getOpsItem('DAY#2026-10-22')).lessonsCompleted, 2);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).activeUsers, 2);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).practiceSessions, 1);
  assert.equal((await repo.getOpsItem('WEEK#2026-w43')).activeUsers, 2);
  assert.equal((await repo.getOpsItem('MONTH#2026-10')).activeUsers, 2);
  assert.equal((await repo.getOpsItem('MONTH#2026-10')).lessonsCompleted, 3);
});

test('completeLessonOnce conta a conclusao aplicada e nao conta o reenvio', async () => {
  const repo = new InMemoryRepo();
  const input = { userId: 'u1', lessonAttemptId: 'attempt-0001', lessonId: 'u1-l1', today: '2026-10-23', score: 1, reviewed: [failed('letra-A')] };
  await completeLessonOnce(repo, catalog, input);
  await completeLessonOnce(repo, catalog, input);

  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).lessonsCompleted, 1);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23#SIGN'))['failed:letra-A'], 1);
});

test('contador com erro nao derruba a licao', async () => {
  const repo = new InMemoryRepo();
  repo.addOpsCounters = async () => {
    throw new Error('DynamoDB fora');
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await completeLessonOnce(repo, catalog, {
      userId: 'u1', lessonAttemptId: 'attempt-0002', lessonId: 'u1-l1', today: '2026-10-23', score: 1,
    });
    assert.equal(r.duplicate, false);
    assert.equal((await repo.getProfile('u1')).xpTotal, 10);
  } finally {
    console.warn = warn;
  }
});

test('migracao do convidado conta cada licao no dia em que foi feita', async () => {
  const repo = new InMemoryRepo();
  await migrateGuest(repo, catalog, {
    userId: 'u1',
    now: new Date('2026-10-23T12:00:00Z'),
    payload: {
      entries: [
        { lessonAttemptId: 'attempt-0010', lessonId: 'u1-l1', today: '2026-10-20', score: 1 },
        { lessonAttemptId: 'attempt-0011', lessonId: 'u1-l2', today: '2026-10-21', score: 1 },
      ],
    },
  });
  assert.equal((await repo.getOpsItem('DAY#2026-10-20')).activeUsers, 1);
  assert.equal((await repo.getOpsItem('DAY#2026-10-21')).activeUsers, 1);
  assert.equal((await repo.getOpsItem('WEEK#2026-w43')).activeUsers, 1);
});

test('migracao do convidado leva o desempenho da camera de cada licao', async () => {
  const repo = new InMemoryRepo();
  await migrateGuest(repo, catalog, {
    userId: 'u1',
    now: new Date('2026-10-23T12:00:00Z'),
    payload: {
      entries: [
        { lessonAttemptId: 'attempt-0020', lessonId: 'u1-l1', today: '2026-10-21', score: 1, cameraStats: { 'letra-B': { successes: 1, skips: 0, attempts: 2, wrong: { A: 1 } } } },
      ],
    },
  });
  assert.deepEqual(await repo.getOpsItem('DAY#2026-10-21#CAMERA'), {
    key: 'DAY#2026-10-21#CAMERA', 'success:letra-B': 1, 'attempts:letra-B': 2, 'wrong:letra-B:A': 1,
  });
});

test('reviewSignsOnce conta a pratica uma vez por rodada', async () => {
  const repo = new InMemoryRepo();
  const input = { userId: 'u1', reviewAttemptId: 'review-0001', today: '2026-10-23', reviewed: [right('letra-A')] };
  await reviewSignsOnce(repo, input);
  await reviewSignsOnce(repo, input);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).practiceSessions, 1);
});

// --- handlers ---

const now = () => new Date('2026-10-23T12:00:00Z');

test('POST /v1/lesson/complete com estatisticas por exercicio soma no painel', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const res = await completeLessonHandler(event({
    body: {
      lessonAttemptId: 'attempt-0100', lessonId: 'u1-l1', today: '2026-10-23', score: 0.5,
      exerciseStats: { match_pairs: { attempted: 2, wrong: 1 } },
    },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23#EXERCISE'))['wrong:match_pairs'], 1);
});

test('POST /v1/lesson/complete com desempenho da camera soma no painel; reenvio nao soma de novo', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const body = {
    lessonAttemptId: 'attempt-0200', lessonId: 'u1-l1', today: '2026-10-23', score: 1,
    cameraStats: {
      'letra-A': { successes: 1, skips: 0, attempts: 3, wrong: { B: 2, 'texto livre': 1 } },
      'letra-Z': { successes: 1, skips: 0, attempts: 1 }, // fora do catalogo: some
    },
  };
  assert.equal((await completeLessonHandler(event({ body }))).statusCode, 200);
  assert.equal((await completeLessonHandler(event({ body }))).statusCode, 200);
  assert.deepEqual(await repo.getOpsItem('DAY#2026-10-23#CAMERA'), {
    key: 'DAY#2026-10-23#CAMERA', 'success:letra-A': 1, 'attempts:letra-A': 3, 'wrong:letra-A:B': 2,
  });
});

test('POST /v1/lesson/complete com cameraStats fora do formato conclui a licao sem somar a camera', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const res = await completeLessonHandler(event({
    body: { lessonAttemptId: 'attempt-0201', lessonId: 'u1-l1', today: '2026-10-23', score: 1, cameraStats: 'muitos' },
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).xpAwarded, 10);
  assert.equal(await repo.getOpsItem('DAY#2026-10-23#CAMERA'), null);
});

test('POST /v1/lesson/complete sem lessonAttemptId (cliente antigo) tambem conta', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  await completeLessonHandler(event({ body: { lessonId: 'u1-l1', today: '2026-10-23', score: 1 } }));
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).lessonsCompleted, 1);
});

test('POST /v1/lesson/abandon valida e soma onde a pessoa parou', async () => {
  const repo = new InMemoryRepo();
  const { abandonLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const body = { lessonId: 'u1-l2', today: '2026-10-23', exerciseIndex: 3, exerciseCount: 10, exerciseType: 'perform_sign' };

  const res = await abandonLessonHandler(event({ body }));
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23#LESSON'))['abandon:u1-l2'], 1);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23#EXERCISE'))['abandon:perform_sign'], 1);
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).activeUsers, 1);

  const bad = async (over) => JSON.parse((await abandonLessonHandler(event({ body: { ...body, ...over } }))).body).error.code;
  assert.equal(await bad({ lessonId: 'nope' }), 'UNKNOWN_LESSON');
  assert.equal(await bad({ exerciseIndex: 11 }), 'BAD_EXERCISE_INDEX');
  assert.equal(await bad({ exerciseType: 'quiz' }), 'BAD_EXERCISE_TYPE');
  assert.equal(await bad({ today: '2020-01-01' }), 'DATE_OUT_OF_RANGE');
  assert.equal((await abandonLessonHandler(event({ sub: null, body }))).statusCode, 401);
});

test('PostConfirmation conta a conta nova no dia de Brasilia e devolve o evento', async () => {
  const repo = new InMemoryRepo();
  const { handler } = makePostConfirmationHandler({ repo, now: () => new Date('2026-10-24T01:00:00Z') });
  const evt = { triggerSource: 'PostConfirmation_ConfirmSignUp', userName: 'x' };
  assert.equal(await handler(evt), evt);
  await handler({ triggerSource: 'PostConfirmation_ConfirmForgotPassword' });
  assert.equal((await repo.getOpsItem('DAY#2026-10-23')).newAccounts, 1);
  assert.equal((await repo.getOpsItem('MONTH#2026-10')).newAccounts, 1);
});

test('PostConfirmation nunca impede o cadastro, mesmo com a tabela fora', async () => {
  const repo = new InMemoryRepo();
  repo.addOpsCounters = async () => {
    throw new Error('fora');
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    const evt = { triggerSource: 'PostConfirmation_ConfirmSignUp' };
    assert.equal(await makePostConfirmationHandler({ repo }).handler(evt), evt);
  } finally {
    console.warn = warn;
  }
});

// --- leitura: tela de operacao ---

test('buildOverview monta 30 dias (com zeros), semanas, meses e os rankings', async () => {
  const repo = new InMemoryRepo();
  await recordLessonCompleted(repo, {
    userId: 'u1', lessonId: 'u1-l1', today: '2026-10-22', reviewed: [failed('letra-A')],
    exerciseStats: { watch_choose_word: { attempted: 4, wrong: 2 } },
  });
  await recordLessonCompleted(repo, { userId: 'u2', lessonId: 'u1-l2', today: '2026-10-23' });
  await repo.setOpsFields('DAY#2026-10-22', { cloud: { api5xx: 2, lambdaErrors: 1, apiRequests: 90, errorsByFunction: { 'librax-get-league': 1 } } });
  await repo.addOpsCounters('DAY#2026-10-23#LESSON', { 'abandon:u1-l2': 3 });

  const o = buildOverview({
    dayItems: await repo.listOpsRange('DAY#2026-09-24', 'DAY#2026-10-23#~'),
    weekItems: await repo.listOpsLatest('WEEK#', 12),
    monthItems: await repo.listOpsLatest('MONTH#', 12),
    today: '2026-10-23',
    labels: { lessons: { 'u1-l2': { title: 'Letras F a J', unitId: 'u1', unitTitle: 'Alfabeto' } }, signs: { 'letra-A': 'A' } },
  });

  assert.equal(o.days.length, 30);
  assert.deepEqual(o.range, { from: '2026-09-24', to: '2026-10-23' });
  assert.equal(o.days[0].activeUsers, 0);
  assert.equal(o.days[0].serverErrors, null); // job ainda nao trouxe o CloudWatch
  const d22 = o.days.find((d) => d.day === '2026-10-22');
  assert.equal(d22.serverErrors, 3);
  assert.equal(o.serverErrors.collectedThrough, '2026-10-22');
  assert.deepEqual(o.serverErrors.byFunction, [{ name: 'librax-get-league', errors: 1 }]);
  assert.equal(o.totals.activeToday, 1);
  assert.equal(o.totals.activeWeek, 2);
  assert.equal(o.totals.activeMonth, 2);
  assert.equal(o.totals.lessonsCompleted, 2);

  const [top] = o.lessons;
  assert.equal(top.lessonId, 'u1-l2');
  assert.equal(top.title, 'Letras F a J');
  assert.equal(top.abandon, 3);
  assert.equal(top.abandonRate, 0.75); // 3 saidas para 1 conclusao
  const l1 = o.lessons.find((l) => l.lessonId === 'u1-l1');
  assert.equal(l1.wrongRate, 0.5);
  assert.deepEqual(o.exercises, [{ type: 'watch_choose_word', attempted: 4, wrong: 2, wrongRate: 0.5, abandon: 0 }]);
  assert.deepEqual(o.signs, [{ signId: 'letra-A', gloss: 'A', failed: 1 }]);
  assert.deepEqual(o.camera, { totals: { signs: 0, runs: 0, successes: 0, skips: 0, wrongReadings: 0 }, signs: [], confusions: [] });
});

test('buildOverview: camera de todas as pessoas na janela, do mais dificil para o mais facil', async () => {
  const repo = new InMemoryRepo();
  const lesson = (userId, today, cameraStats) => recordLessonCompleted(repo, { userId, lessonId: 'u1-l1', today, cameraStats });
  await lesson('u1', '2026-10-22', {
    'letra-K': { successes: 1, skips: 1, attempts: 3, wrong: { H: 2 } },
    'letra-A': { successes: 2, skips: 0, attempts: 2, wrong: {} },
  });
  await lesson('u2', '2026-10-23', {
    'letra-K': { successes: 0, skips: 1, attempts: 0, wrong: { H: 1, V: 1 } },
    'sinal-MESA': { successes: 1, skips: 0, attempts: 4, wrong: { CASA: 3 } },
  });
  // fora da janela de 30 dias: nao entra
  await lesson('u3', '2026-09-01', { 'letra-A': { successes: 0, skips: 5, attempts: 0, wrong: {} } });

  const { camera } = buildOverview({
    dayItems: await repo.listOpsRange('DAY#2026-09-01', 'DAY#2026-10-23#~'),
    today: '2026-10-23',
    labels: { signs: { 'letra-K': 'K', 'letra-A': 'A', 'sinal-MESA': 'MESA' }, signKinds: { 'letra-K': 'letter', 'letra-A': 'letter', 'sinal-MESA': 'sign' } },
  });

  assert.deepEqual(camera.signs.map((s) => s.signId), ['letra-K', 'sinal-MESA', 'letra-A']);
  const [k, mesa, a] = camera.signs;
  assert.deepEqual(k, {
    signId: 'letra-K', gloss: 'K', kind: 'letter', runs: 3, successes: 1, skips: 2, skipRate: 0.667,
    attempts: 3, avgAttempts: 3, wrongReadings: 4, topWrong: [{ label: 'H', count: 3 }, { label: 'V', count: 1 }], level: 'hard',
  });
  assert.equal(mesa.avgAttempts, 4);
  assert.equal(mesa.kind, 'sign');
  assert.equal(a.level, 'ok');
  assert.equal(a.runs, 2);
  assert.deepEqual(camera.totals, { signs: 3, runs: 6, successes: 4, skips: 2, wrongReadings: 7 });
  assert.deepEqual(camera.confusions.slice(0, 2), [
    { signId: 'letra-K', gloss: 'K', label: 'H', count: 3 },
    { signId: 'sinal-MESA', gloss: 'MESA', label: 'CASA', count: 3 },
  ]);
});

test('cameraDifficulty: mesma regra da tela do app', () => {
  assert.equal(cameraDifficulty(0.5, 1), 'hard');
  assert.equal(cameraDifficulty(0, 3), 'hard');
  assert.equal(cameraDifficulty(0.2, null), 'attention');
  assert.equal(cameraDifficulty(0.1, 2), 'attention');
  assert.equal(cameraDifficulty(0.1, 1.5), 'ok');
});

// --- DynamoRepo: formato das escritas ---

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

test('DynamoRepo.addOpsCounters: ADD com nomes planos e TTL so na criacao', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).addOpsCounters('DAY#2026-10-23#LESSON', { 'done:u1-l1': 1, 'wrong:u1-l1': 2 }, { expiresAt: 123 });
  const [{ name, input }] = db.calls;
  assert.equal(name, 'UpdateCommand');
  assert.deepEqual(input.Key, { PK: 'OPS', SK: 'DAY#2026-10-23#LESSON' });
  assert.equal(input.UpdateExpression, 'ADD #c0 :c0, #c1 :c1 SET expiresAt = if_not_exists(expiresAt, :exp)');
  assert.deepEqual(input.ExpressionAttributeNames, { '#c0': 'done:u1-l1', '#c1': 'wrong:u1-l1' });
  assert.deepEqual(input.ExpressionAttributeValues, { ':c0': 1, ':c1': 2, ':exp': 123 });
});

test('DynamoRepo.listOpsRange le a janela com uma Query (BETWEEN), nunca Scan', async () => {
  const db = fakeClient(() => ({ Items: [{ PK: 'OPS', SK: 'DAY#2026-10-23', activeUsers: 2, expiresAt: 1 }] }));
  const items = await new DynamoRepo(db).listOpsRange('DAY#2026-09-24', 'DAY#2026-10-23#~');
  assert.deepEqual(items, [{ key: 'DAY#2026-10-23', activeUsers: 2 }]);
  assert.equal(db.calls.every((c) => c.name === 'QueryCommand'), true);
  assert.equal(db.calls[0].input.KeyConditionExpression, 'PK = :pk AND SK BETWEEN :from AND :to');
});

test('DynamoRepo.markActivity le antes e so escreve na primeira atividade do dia', async () => {
  const seen = { Item: { PK: 'USER#u1', SK: 'ACTIVITY', lastDay: '2026-10-23', lastWeek: '2026-w43', lastMonth: '2026-10' } };
  const db = fakeClient((name) => (name === 'GetCommand' ? seen : {}));
  assert.deepEqual(await new DynamoRepo(db).markActivity('u1', periodsOf('2026-10-23')), { day: false, week: false, month: false });
  assert.deepEqual(db.calls.map((c) => c.name), ['GetCommand']);

  const db2 = fakeClient((name) => (name === 'GetCommand'
    ? { Item: { lastDay: '2026-10-22', lastWeek: '2026-w43', lastMonth: '2026-10' } }
    : { Attributes: { lastDay: '2026-10-22', lastWeek: '2026-w43', lastMonth: '2026-10' } }));
  assert.deepEqual(await new DynamoRepo(db2).markActivity('u1', periodsOf('2026-10-23')), { day: true, week: false, month: false });
  const update = db2.calls.find((c) => c.name === 'UpdateCommand').input;
  assert.equal(update.ConditionExpression, 'attribute_not_exists(lastDay) OR lastDay < :d');
  assert.equal(update.ReturnValues, 'UPDATED_OLD');
});

test('DynamoRepo.markActivity: duas licoes ao mesmo tempo contam uma vez (condicao no dia)', async () => {
  const db = fakeClient((name) => {
    if (name === 'GetCommand') return {};
    const err = new Error('ja contou');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  });
  assert.deepEqual(await new DynamoRepo(db).markActivity('u1', periodsOf('2026-10-23')), { day: false, week: false, month: false });
});

test('DynamoRepo.putSquad grava o registro SQUADINDEX fora do META', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).putSquad({ squadId: 's1', name: 'Coda', type: 'private', createdAt: '2026-10-23T12:00:00.000Z' });
  const index = db.calls.find((c) => c.input.Item?.PK === 'SQUADINDEX');
  assert.equal(index.input.Item.SK, 'SQUAD#2026-10-23T12:00:00.000Z#s1');
  assert.equal(index.input.Item.squadId, 's1');
});
