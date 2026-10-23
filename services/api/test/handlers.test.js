import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGuestHandlers } from '../src/handlers/guest.js';
import { makeLessonHandlers } from '../src/handlers/lesson.js';
import { makePracticeHandlers } from '../src/handlers/practice.js';
import { makePushHandlers } from '../src/handlers/push.js';
import { makeCloseLeagueHandler } from '../src/handlers/closeLeague.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { LIMITS } from '../src/domain/lessonCompletion.js';

// Borda HTTP (API Gateway HTTP API, payload 2.0): auth pelo sub do JWT, limite de tamanho,
// validacao e envelope de erro { error: { code, message } }. Repo em memoria injetado.

const catalog = {
  lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10, signCount: 1 } },
  signsOrder: ['letra-A'],
  alphabetLessonId: 'u1-l1',
  achievementRules: [],
};
const now = () => new Date('2026-10-23T12:00:00Z');

function event({ sub = 'u1', claims = {}, body, pathParameters } = {}) {
  return {
    requestContext: { authorizer: sub ? { jwt: { claims: { sub, ...claims } } } : undefined },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    pathParameters,
  };
}
const parse = (res) => JSON.parse(res.body);

const entry = (id, over = {}) => ({
  lessonAttemptId: id,
  lessonId: 'u1-l1',
  today: '2026-10-22',
  score: 1,
  reviewed: [],
  ...over,
});

// --- POST /v1/guest/migrate ---

test('guest/migrate exige usuario autenticado', async () => {
  const { migrateGuestHandler } = makeGuestHandlers({ repo: new InMemoryRepo(), catalog, now });
  const res = await migrateGuestHandler(event({ sub: null, body: { entries: [entry('attempt-0001')] } }));
  assert.equal(res.statusCode, 401);
});

test('guest/migrate aplica o log e e idempotente no reenvio', async () => {
  const repo = new InMemoryRepo();
  const { migrateGuestHandler } = makeGuestHandlers({ repo, catalog, now });
  const body = { entries: [entry('attempt-0001'), entry('attempt-0002', { today: '2026-10-23' })] };

  const r1 = await migrateGuestHandler(event({ body }));
  const r2 = await migrateGuestHandler(event({ body }));

  assert.equal(r1.statusCode, 200);
  assert.deepEqual(parse(r1).summary, { applied: 2, duplicate: 0, rejected: 0 });
  assert.deepEqual(parse(r2).summary, { applied: 0, duplicate: 2, rejected: 0 });
  assert.equal((await repo.getProfile('u1')).xpTotal, 20);
});

test('guest/migrate recusa corpo acima do limite com 413', async () => {
  const { migrateGuestHandler } = makeGuestHandlers({ repo: new InMemoryRepo(), catalog, now });
  const big = JSON.stringify({ entries: [entry('attempt-0001', { pad: 'x'.repeat(LIMITS.maxBodyBytes) })] });
  const res = await migrateGuestHandler(event({ body: big }));
  assert.equal(res.statusCode, 413);
  assert.equal(parse(res).error.code, 'PAYLOAD_TOO_LARGE');
});

test('guest/migrate valida o formato do payload', async () => {
  const { migrateGuestHandler } = makeGuestHandlers({ repo: new InMemoryRepo(), catalog, now });
  assert.equal((await migrateGuestHandler(event({ body: '{nao e json' }))).statusCode, 400);
  const empty = await migrateGuestHandler(event({ body: { entries: [] } }));
  assert.equal(empty.statusCode, 400);
  assert.equal(parse(empty).error.code, 'EMPTY_LOG');
  const many = await migrateGuestHandler(
    event({ body: { entries: Array.from({ length: LIMITS.maxEntries + 1 }, (_, i) => entry(`attempt-${1000 + i}`)) } }),
  );
  assert.equal(many.statusCode, 400);
  assert.equal(parse(many).error.code, 'TOO_MANY_ENTRIES');
});

// --- POST /v1/lesson/complete ---

test('lesson/complete com lessonAttemptId nao duplica no reenvio da fila offline', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const body = entry('attempt-0001');

  const r1 = await completeLessonHandler(event({ body }));
  const r2 = await completeLessonHandler(event({ body }));

  assert.equal(r1.statusCode, 200);
  assert.equal(parse(r1).duplicate, false);
  assert.equal(parse(r2).duplicate, true);
  assert.equal((await repo.getProfile('u1')).xpTotal, 10);
});

test('lesson/complete sem lessonAttemptId continua aceito (cliente antigo)', async () => {
  const repo = new InMemoryRepo();
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now });
  const res = await completeLessonHandler(event({ body: entry(undefined) }));
  assert.equal(res.statusCode, 200);
  assert.equal(parse(res).xpAwarded, 10);
});

test('lesson/complete usa o relogio do servidor para a semana da liga', async () => {
  const repo = new InMemoryRepo();
  // segunda 01:00 UTC: no Brasil ainda e domingo, mas a semana da liga ja virou
  const monday = () => new Date('2026-10-26T01:00:00Z');
  const { completeLessonHandler } = makeLessonHandlers({ repo, catalog, now: monday });
  const res = await completeLessonHandler(event({ body: entry('attempt-0001', { today: '2026-10-25' }) }));

  assert.equal(parse(res).leagueId, 'bronze-2026-w44');
  assert.equal(await repo.getLeagueMemberXp('bronze-2026-w44', 'u1'), 10);
});

test('guest/migrate: so as licoes da semana atual entram na liga', async () => {
  const repo = new InMemoryRepo();
  const { migrateGuestHandler } = makeGuestHandlers({ repo, catalog, now });
  await migrateGuestHandler(event({
    body: { entries: [entry('attempt-0001', { today: '2026-09-01' }), entry('attempt-0002')] },
  }));

  assert.equal((await repo.getProfile('u1')).xpTotal, 20);
  assert.equal(await repo.getLeagueMemberXp('bronze-2026-w43', 'u1'), 10);
});

test('lesson/complete rejeita licao desconhecida com 400', async () => {
  const { completeLessonHandler } = makeLessonHandlers({ repo: new InMemoryRepo(), catalog, now });
  const res = await completeLessonHandler(event({ body: entry('attempt-0001', { lessonId: 'x' }) }));
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).error.code, 'UNKNOWN_LESSON');
});

// --- POST /v1/practice/review ---

const review = (id, over = {}) => ({
  reviewAttemptId: id,
  today: '2026-10-23',
  reviewed: [{ signId: 'letra-A', result: { state: 'correct', highConfidence: true } }],
  ...over,
});

test('practice/review exige usuario autenticado', async () => {
  const { reviewSignsHandler } = makePracticeHandlers({ repo: new InMemoryRepo(), catalog, now });
  const res = await reviewSignsHandler(event({ sub: null, body: review('review-0001') }));
  assert.equal(res.statusCode, 401);
});

test('practice/review grava o SRS sem XP e nao duplica no reenvio', async () => {
  const repo = new InMemoryRepo();
  const { reviewSignsHandler } = makePracticeHandlers({ repo, catalog, now });

  const r1 = await reviewSignsHandler(event({ body: review('review-0001') }));
  const r2 = await reviewSignsHandler(event({ body: review('review-0001') }));

  assert.equal(r1.statusCode, 200);
  assert.equal(parse(r1).duplicate, false);
  assert.equal(parse(r1).srsUpdated, 1);
  assert.equal(parse(r2).duplicate, true);
  const item = await repo.getSrsItem('u1', 'letra-A');
  assert.equal(item.reps, 1);
  assert.equal(item.dueAt, '2026-10-24');
  assert.equal(await repo.getProfile('u1'), null); // sem XP nem ofensiva: o perfil nem e criado
});

test('practice/review valida id, sinal e data', async () => {
  const { reviewSignsHandler } = makePracticeHandlers({ repo: new InMemoryRepo(), catalog, now });
  const code = async (body) => parse(await reviewSignsHandler(event({ body }))).error?.code;

  assert.equal(await code(review(undefined)), 'BAD_ATTEMPT_ID');
  assert.equal(
    await code(review('review-0001', { reviewed: [{ signId: 'letra-Z', result: { state: 'correct' } }] })),
    'BAD_REVIEWED',
  );
  assert.equal(await code(review('review-0001', { today: '2026-13-01' })), 'BAD_DATE');
  assert.equal((await reviewSignsHandler(event({ body: '{x' }))).statusCode, 400);
});

// --- Web Push: inscricao e remocao ---

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  expirationTime: null,
  keys: { p256dh: 'BOr1x9H1a2b3c4d5e6f7g8h9i0', auth: 'k3y-4uth_abc' },
};

test('inscricao guarda em USER#<id> / PUSH#<hash> e devolve o id', async () => {
  const repo = new InMemoryRepo();
  const { subscribePushHandler } = makePushHandlers({ repo, now });

  const res = await subscribePushHandler(event({ body: { ...subscription, timezone: 'America/Recife' } }));

  assert.equal(res.statusCode, 201);
  const { subscriptionId } = parse(res);
  assert.match(subscriptionId, /^[0-9a-f]{32}$/);
  const subs = await repo.listPushSubscriptions('u1');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].endpoint, subscription.endpoint);
  const notif = await repo.getNotifState('u1');
  assert.equal(notif.timezone, 'America/Recife');
  assert.equal(notif.reminderHour, 19); // padrao ao ligar lembretes
  assert.equal(notif.lastSeenAt, '2026-10-23T12:00:00.000Z');
});

test('inscricao repetida do mesmo endpoint nao duplica', async () => {
  const repo = new InMemoryRepo();
  const { subscribePushHandler } = makePushHandlers({ repo, now });
  await subscribePushHandler(event({ body: subscription }));
  await subscribePushHandler(event({ body: subscription }));
  assert.equal((await repo.listPushSubscriptions('u1')).length, 1);
});

test('inscricao rejeita endpoint fora dos servicos de push conhecidos (SSRF)', async () => {
  const { subscribePushHandler } = makePushHandlers({ repo: new InMemoryRepo(), now });
  const res = await subscribePushHandler(
    event({ body: { ...subscription, endpoint: 'https://169.254.169.254/latest/meta-data' } }),
  );
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).error.code, 'PUSH_HOST_NOT_ALLOWED');
});

test('inscricao marca interacao quando o app abriu pela notificacao', async () => {
  const repo = new InMemoryRepo();
  const { subscribePushHandler } = makePushHandlers({ repo, now });
  await subscribePushHandler(event({ body: { ...subscription, openedFromNotification: true } }));
  assert.equal((await repo.getNotifState('u1')).lastInteractionAt, '2026-10-23T12:00:00.000Z');
});

test('remocao apaga so a inscricao do proprio usuario', async () => {
  const repo = new InMemoryRepo();
  const { subscribePushHandler, unsubscribePushHandler } = makePushHandlers({ repo, now });
  const { subscriptionId } = parse(await subscribePushHandler(event({ body: subscription })));

  await unsubscribePushHandler(event({ sub: 'intruso', pathParameters: { subscriptionId } }));
  assert.equal((await repo.listPushSubscriptions('u1')).length, 1);

  const res = await unsubscribePushHandler(event({ pathParameters: { subscriptionId } }));
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.listPushSubscriptions('u1')).length, 0);
});

test('remocao valida o formato do id', async () => {
  const { unsubscribePushHandler } = makePushHandlers({ repo: new InMemoryRepo(), now });
  const res = await unsubscribePushHandler(event({ pathParameters: { subscriptionId: '../x' } }));
  assert.equal(res.statusCode, 400);
});

// --- Preferencias de lembrete (push + e-mail opt-in) ---

test('preferencias: e-mail so com opt-in e e-mail verificado no token', async () => {
  const repo = new InMemoryRepo();
  const { updateNotificationPrefsHandler } = makePushHandlers({ repo, now });
  const prefs = { reminderHour: 20, timezone: 'America/Sao_Paulo', emailOptIn: true };

  const noEmail = await updateNotificationPrefsHandler(event({ body: prefs }));
  assert.equal(noEmail.statusCode, 400);
  assert.equal(parse(noEmail).error.code, 'EMAIL_NOT_VERIFIED');

  const ok = await updateNotificationPrefsHandler(
    event({ body: prefs, claims: { email: 'ana@exemplo.com', email_verified: 'true' } }),
  );
  assert.equal(ok.statusCode, 200);
  const notif = await repo.getNotifState('u1');
  assert.equal(notif.emailOptIn, true);
  assert.equal(notif.email, 'ana@exemplo.com');
  assert.equal(notif.reminderHour, 20);
});

test('preferencias: horario no periodo de silencio e fuso invalido sao recusados', async () => {
  const { updateNotificationPrefsHandler } = makePushHandlers({ repo: new InMemoryRepo(), now });
  const quiet = await updateNotificationPrefsHandler(
    event({ body: { reminderHour: 23, timezone: 'America/Sao_Paulo', emailOptIn: false } }),
  );
  assert.equal(parse(quiet).error.code, 'REMINDER_IN_QUIET_HOURS');
  const tz = await updateNotificationPrefsHandler(
    event({ body: { reminderHour: 19, timezone: 'Lua/Base', emailOptIn: false } }),
  );
  assert.equal(parse(tz).error.code, 'BAD_TIMEZONE');
});

test('preferencias: opt-out do e-mail apaga o endereco guardado', async () => {
  const repo = new InMemoryRepo();
  const { updateNotificationPrefsHandler } = makePushHandlers({ repo, now });
  const claims = { email: 'ana@exemplo.com', email_verified: 'true' };
  await updateNotificationPrefsHandler(
    event({ body: { reminderHour: 20, timezone: 'America/Sao_Paulo', emailOptIn: true }, claims }),
  );
  await updateNotificationPrefsHandler(
    event({ body: { reminderHour: 20, timezone: 'America/Sao_Paulo', emailOptIn: false }, claims }),
  );
  const notif = await repo.getNotifState('u1');
  assert.equal(notif.emailOptIn, false);
  assert.equal(notif.email, null);
});

// --- Lambda do Scheduler: fechamento semanal da liga ---

async function seedOuroW43(repo) {
  const l = { leagueId: 'ouro-2026-w43', tier: 'ouro', period: '2026-w43', periodStart: '2026-10-19' };
  for (const [userId, xp] of [['u1', 50], ['u2', 30], ['u3', 20], ['u4', 10]]) {
    await repo.joinLeague(l, userId);
    await repo.incrementLeagueXp(l.leagueId, userId, xp);
  }
}

test('closeLeague: evento do Scheduler sem leagueId fecha a semana que terminou', async () => {
  const repo = new InMemoryRepo();
  await seedOuroW43(repo);
  const { handler } = makeCloseLeagueHandler({ repo, now: () => new Date('2026-10-26T00:05:00Z') });

  const report = await handler({});

  assert.equal(report.period, '2026-w43');
  assert.equal(report.closed, 1);
  assert.equal((await repo.getLeague('ouro-2026-w43')).status, 'closed');
  assert.equal((await repo.getLeagueState('u1')).tier, 'safira');
});

test('closeLeague: periodStart explicito permite refazer uma semana antiga', async () => {
  const repo = new InMemoryRepo();
  await seedOuroW43(repo);
  const { handler } = makeCloseLeagueHandler({ repo, now: () => new Date('2026-11-20T10:00:00Z') });

  const report = await handler({ periodStart: '2026-10-19' });

  assert.equal(report.period, '2026-w43');
  assert.equal(report.closed, 1);
  await assert.rejects(() => handler({ periodStart: '2026-10-21' }), /INVALID_PERIOD/);
});
