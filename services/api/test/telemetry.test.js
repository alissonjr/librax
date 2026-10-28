import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseTelemetryBatch,
  parseSnapshot,
  planTelemetry,
  buildUsage,
  localDay,
  isTelemetryId,
  TELEMETRY_MAX_EVENTS,
  TELEMETRY_TTL_DAYS,
} from '../src/domain/telemetry.js';
import { parseFeedback, cleanFeedbackText, FEEDBACK_TEXT_MAX } from '../src/domain/feedback.js';
import { ingestTelemetry, deleteTelemetry, submitFeedback, usageOverview, feedbackPage } from '../src/usecases/telemetry.js';
import { makeTelemetryHandlers } from '../src/handlers/telemetry.js';
import { makeAdminHandlers } from '../src/handlers/admin.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { DynamoRepo } from '../src/adapters/dynamoRepo.js';

// Dados de uso anonimos e nota do app: rotas publicas, validacao estrita, somas na escrita e a
// copia na nuvem apagada pelo proprio codigo anonimo.

const catalog = {
  lessons: Object.fromEntries(['u1-l1', 'u1-l2', 'u1-l3', 'u1-l4', 'u1-l5', 'u1-l6'].map((id) => [id, { id, xpReward: 10, signCount: 2 }])),
};
const ID = '0b6a3c1e-5f2d-4a8b-9c7e-1d2f3a4b5c6d';
const ID2 = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';
const NOW = new Date('2026-10-27T15:00:00Z');
const BRT = 180; // getTimezoneOffset de Brasilia
const at = (iso) => new Date(iso).getTime();

const snapshot = (over = {}) => ({
  lessonsCompleted: 0, xpTotal: 0, streak: 0, currentLessonId: 'u1-l1', hasAccount: false,
  appVersion: '2026-10-27+abc1234', lang: 'pt-BR', platform: 'android', installed: 'browser', ...over,
});
const batch = (events, { snapshot: s, ...rest } = {}) => ({ v: 1, id: ID, tz: BRT, events, ...rest, snapshot: snapshot(s) });
const ev = (type, iso, fields = {}) => ({ type, at: at(iso), ...fields });
const parsed = (raw, now = NOW) => {
  const r = parseTelemetryBatch(raw, { catalog, now });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value;
};

// ---------------------------------------------------------------------------
// validacao
// ---------------------------------------------------------------------------

test('codigo anonimo: so UUID v4 em minusculas', () => {
  assert.equal(isTelemetryId(ID), true);
  for (const bad of [ID.toUpperCase(), 'usr-' + ID, '123', '', null, `${ID}x`, '0b6a3c1e-5f2d-1a8b-9c7e-1d2f3a4b5c6d']) {
    assert.equal(isTelemetryId(bad), false, String(bad));
  }
});

test('dia local pelo fuso do aparelho', () => {
  assert.equal(localDay(at('2026-10-27T02:00:00Z'), BRT), '2026-10-26');
  assert.equal(localDay(at('2026-10-27T03:00:00Z'), BRT), '2026-10-27');
});

test('lote valido: cada tipo com os seus campos e nada alem deles', () => {
  const r = parseTelemetryBatch(batch([
    ev('app_open', '2026-10-27T12:00:00Z', { email: 'ana@exemplo.com', userId: 'usr-1' }),
    ev('onboarding_done', '2026-10-27T12:01:00Z', { lang: 'en', dailyGoal: 20, name: 'Ana' }),
    ev('lesson_open', '2026-10-27T12:02:00Z', { lessonId: 'u1-l1' }),
    ev('lesson_complete', '2026-10-27T12:05:00Z', { lessonId: 'u1-l1', score: 0.9, xp: 10, durationSec: 180 }),
    ev('lesson_abandon', '2026-10-27T12:06:00Z', { lessonId: 'u1-l2', exerciseIndex: 3, exerciseCount: 8 }),
    ev('daily_goal_met', '2026-10-27T12:05:00Z'),
    ev('placement_started', '2026-10-27T12:07:00Z', { camera: false }),
    ev('placement_done', '2026-10-27T12:08:00Z', { placed: 4 }),
    ev('practice_done', '2026-10-27T12:09:00Z', { mode: 'review', items: 10, correct: 7 }),
    ev('account_created', '2026-10-27T12:10:00Z'),
  ], { snapshot: { deviceId: 'abc', email: 'x@y.z' } }), { catalog, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.dropped, 0);
  assert.equal(r.value.events.length, 10);
  assert.deepEqual(r.value.events[0], { type: 'app_open', at: at('2026-10-27T12:00:00Z'), day: '2026-10-27' });
  assert.deepEqual(r.value.events[1], { type: 'onboarding_done', at: at('2026-10-27T12:01:00Z'), day: '2026-10-27', lang: 'en', dailyGoal: 20 });
  // nada fora da lista entra (e-mail, id, nome, codigo do aparelho)
  const all = JSON.stringify(r.value);
  for (const pii of ['ana@exemplo.com', 'usr-1', 'Ana', 'x@y.z', 'deviceId']) assert.equal(all.includes(pii), false, pii);
  assert.deepEqual(Object.keys(r.value.snapshot).sort(), [
    'appVersion', 'currentLessonId', 'hasAccount', 'installed', 'lang', 'lessonsCompleted', 'platform', 'streak', 'xpTotal',
  ]);
});

test('evento fora do formato ou da janela de horario sai sozinho; o resto do lote vale', () => {
  const r = parseTelemetryBatch(batch([
    ev('app_open', '2026-10-27T12:00:00Z'),
    ev('desconhecido', '2026-10-27T12:00:00Z'),
    ev('lesson_open', '2026-10-27T12:00:00Z', { lessonId: 'u9-l9' }),
    ev('lesson_complete', '2026-10-27T12:00:00Z', { lessonId: 'u1-l1', score: 1.5, xp: 10 }),
    ev('lesson_complete', '2026-10-27T12:00:00Z', { lessonId: 'u1-l1', score: 1, xp: 10, durationSec: 99999 }),
    ev('lesson_abandon', '2026-10-27T12:00:00Z', { lessonId: 'u1-l1', exerciseIndex: 8, exerciseCount: 8 }),
    ev('practice_done', '2026-10-27T12:00:00Z', { mode: 'review', items: 5, correct: 6 }),
    ev('onboarding_done', '2026-10-27T12:00:00Z', { lang: 'fr', dailyGoal: 10 }),
    ev('app_open', '2026-09-20T12:00:00Z'), // mais de 30 dias
    ev('app_open', '2026-10-29T12:00:00Z'), // mais de 1 dia no futuro
    { type: 'app_open', at: '2026-10-27' },
    'app_open',
  ]), { catalog, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.value.events.length, 1);
  assert.equal(r.dropped, 11);
});

test('envelope errado recusa o lote', () => {
  const cases = [
    [null, 'BAD_BATCH'],
    [{ ...batch([ev('app_open', '2026-10-27T12:00:00Z')]), v: 2 }, 'BAD_VERSION'],
    [{ ...batch([ev('app_open', '2026-10-27T12:00:00Z')]), id: 'abc' }, 'BAD_ID'],
    [{ ...batch([ev('app_open', '2026-10-27T12:00:00Z')]), tz: 2000 }, 'BAD_TZ'],
    [batch([]), 'NO_EVENTS'],
    [batch(Array.from({ length: TELEMETRY_MAX_EVENTS + 1 }, () => ev('app_open', '2026-10-27T12:00:00Z'))), 'TOO_MANY_EVENTS'],
    [batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { hasAccount: 'sim' } }), 'BAD_SNAPSHOT'],
    [batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { lessonsCompleted: -1 } }), 'BAD_SNAPSHOT'],
    [batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { platform: 'Mozilla/5.0' } }), 'BAD_SNAPSHOT'],
    [batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { currentLessonId: 'u9-l1' } }), 'BAD_SNAPSHOT'],
    [batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { appVersion: '<script>' } }), 'BAD_SNAPSHOT'],
  ];
  for (const [raw, error] of cases) assert.equal(parseTelemetryBatch(raw, { catalog, now: NOW }).error, error, error);
  assert.equal(parseSnapshot(snapshot({ currentLessonId: null, appVersion: null }), catalog).ok, true);
});

// ---------------------------------------------------------------------------
// somas na escrita
// ---------------------------------------------------------------------------

const counters = (writes, key) => writes.find((w) => w.key === key)?.counters ?? {};

test('codigo novo, do zero: entra na coorte do dia, conta como ativo convidado no dia, semana e mes', () => {
  const { item, writes } = planTelemetry({
    old: null,
    batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z'), ev('onboarding_done', '2026-10-27T12:01:00Z', { lang: 'pt-BR', dailyGoal: 10 })])),
    now: NOW,
  });
  assert.equal(item.rev, 1);
  assert.equal(item.firstDay, '2026-10-27');
  assert.equal(item.fresh, true);
  assert.deepEqual(item.milestones, { onboarding: '2026-10-27' });
  assert.equal(item.expiresAt, Math.floor(NOW.getTime() / 1000) + TELEMETRY_TTL_DAYS * 86400);
  assert.deepEqual(counters(writes, 'DAY#2026-10-27'), {
    newIds: 1, f_open: 1, active_guest: 1, 'plat:android:browser': 1, 'ev:app_open': 1, 'ev:onboarding_done': 1,
    'lang:pt-BR': 1, 'goal:10': 1, f_onboarding: 1,
  });
  assert.deepEqual(counters(writes, 'WEEK#2026-w44'), { active_guest: 1 });
  assert.deepEqual(counters(writes, 'MONTH#2026-10'), { active_guest: 1 });
  // poucas escritas por lote
  assert.ok(writes.length <= 4);
});

test('mesmo dia de novo: nao conta como ativo outra vez; licoes, alcance e funil uma vez cada', () => {
  let state = planTelemetry({ old: null, batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')])), now: NOW });
  const lesson = (id, iso) => [
    ev('lesson_open', iso, { lessonId: id }),
    ev('lesson_complete', iso, { lessonId: id, score: 0.8, xp: 10, durationSec: 120 }),
  ];
  state = planTelemetry({
    old: state.item,
    batch: parsed(batch([...lesson('u1-l1', '2026-10-27T13:00:00Z'), ...lesson('u1-l1', '2026-10-27T13:10:00Z')], { snapshot: { lessonsCompleted: 1 } })),
    now: NOW,
  });
  const day = counters(state.writes, 'DAY#2026-10-27');
  assert.equal(day.active_guest, undefined);
  assert.equal(day['ev:lesson_complete'], 2);
  assert.equal(day.f_lesson1, 1);
  assert.deepEqual(counters(state.writes, 'DAY#2026-10-27#L#u1-l1'), { open: 2, done: 2, score: 160, sec: 240, timed: 2 });
  assert.deepEqual(counters(state.writes, 'REACH'), { 'done:u1-l1': 1 });
  assert.deepEqual(state.item.completed, ['u1-l1']);
  assert.equal(state.item.rev, 2);

  // a mesma licao de novo nao soma no alcance; o funil nao repete
  state = planTelemetry({ old: state.item, batch: parsed(batch(lesson('u1-l1', '2026-10-27T14:00:00Z'), { snapshot: { lessonsCompleted: 1 } })), now: NOW });
  assert.deepEqual(counters(state.writes, 'REACH'), {});
  assert.equal(counters(state.writes, 'DAY#2026-10-27').f_lesson1, undefined);
});

test('D1 e D7: volta 1 e 7 dias depois soma na coorte do primeiro dia; a conta muda o tipo do ativo', () => {
  const first = planTelemetry({ old: null, batch: parsed(batch([ev('app_open', '2026-10-20T12:00:00Z')])), now: NOW });
  const d1 = planTelemetry({ old: first.item, batch: parsed(batch([ev('app_open', '2026-10-21T12:00:00Z')])), now: NOW });
  assert.equal(counters(d1.writes, 'DAY#2026-10-20').ret1, 1);
  assert.equal(counters(d1.writes, 'DAY#2026-10-21').active_guest, 1);
  assert.deepEqual(counters(d1.writes, 'WEEK#2026-w43'), {}); // mesma semana
  const d7 = planTelemetry({
    old: d1.item,
    batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { hasAccount: true, lessonsCompleted: 5 } })),
    now: NOW,
  });
  const cohort = counters(d7.writes, 'DAY#2026-10-20');
  assert.equal(cohort.ret7, 1);
  assert.equal(cohort.f_account, 1);
  assert.equal(cohort.f_lesson1, 1);
  assert.equal(cohort.f_lesson5, 1);
  assert.equal(counters(d7.writes, 'DAY#2026-10-27').active_account, 1);
  assert.equal(counters(d7.writes, 'WEEK#2026-w44').active_account, 1);
  // dia mais velho que o ultimo contado (fila antiga) nao conta de novo
  const late = planTelemetry({ old: d7.item, batch: parsed(batch([ev('app_open', '2026-10-25T12:00:00Z')])), now: NOW });
  assert.equal(counters(late.writes, 'DAY#2026-10-25').active_guest, undefined);
});

test('quem ja usava o app (com licoes) nao entra na coorte nem no funil', () => {
  const { item, writes } = planTelemetry({
    old: null,
    batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')], { snapshot: { lessonsCompleted: 12, xpTotal: 300 } })),
    now: NOW,
  });
  assert.equal(item.fresh, false);
  const day = counters(writes, 'DAY#2026-10-27');
  assert.equal(day.newIds, 1);
  assert.equal(day.f_open, undefined);
  assert.equal(day.f_lesson5, undefined);
  assert.equal(day.active_guest, 1);
});

test('ingestTelemetry: trava otimista le de novo quando outro lote grava antes', async () => {
  const repo = new InMemoryRepo();
  let raced = false;
  const racing = {
    getTelemetryMeta: (id) => repo.getTelemetryMeta(id),
    addTelemetryCounters: (...args) => repo.addTelemetryCounters(...args),
    async putTelemetryMeta(id, item, opts) {
      if (!raced) {
        raced = true;
        // outro lote do mesmo aparelho grava no meio
        await ingestTelemetry(repo, { batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')])), now: NOW });
      }
      return repo.putTelemetryMeta(id, item, opts);
    },
  };
  await ingestTelemetry(racing, { batch: parsed(batch([ev('lesson_open', '2026-10-27T12:05:00Z', { lessonId: 'u1-l1' })])), now: NOW });
  const meta = await repo.getTelemetryMeta(ID);
  assert.equal(meta.rev, 2);
  assert.deepEqual(meta.counts, { app_open: 1, lesson_open: 1 });
  const day = await repo.getTelemetryAgg('DAY#2026-10-27');
  assert.equal(day.active_guest, 1); // contado uma vez so
  assert.equal(day.newIds, 1);
});

// ---------------------------------------------------------------------------
// nota do app
// ---------------------------------------------------------------------------

test('nota: inteira de 1 a 5, comentario limpo e com teto, retrato conferido', () => {
  const ok = parseFeedback({ id: ID, rating: 4, text: '  Muito bom\u0000‮!\r\n\r\n\r\n\tObrigado  ', snapshot: snapshot({ lessonsCompleted: 2 }) }, { catalog });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.text, 'Muito bom!\n\n Obrigado');
  assert.deepEqual(Object.keys(ok.value.context).sort(), ['appVersion', 'currentLessonId', 'hasAccount', 'installed', 'lang', 'lessonsCompleted', 'platform']);
  assert.equal(parseFeedback({ id: ID, rating: 5, snapshot: snapshot() }, { catalog }).value.text, '');
  for (const [raw, error] of [
    [{ id: ID, rating: 0, snapshot: snapshot() }, 'BAD_RATING'],
    [{ id: ID, rating: 6, snapshot: snapshot() }, 'BAD_RATING'],
    [{ id: ID, rating: 4.5, snapshot: snapshot() }, 'BAD_RATING'],
    [{ id: ID, rating: '5', snapshot: snapshot() }, 'BAD_RATING'],
    [{ id: 'x', rating: 5, snapshot: snapshot() }, 'BAD_ID'],
    [{ id: ID, rating: 5, text: 42, snapshot: snapshot() }, 'BAD_TEXT'],
    [{ id: ID, rating: 5, text: 'a'.repeat(FEEDBACK_TEXT_MAX + 1), snapshot: snapshot() }, 'TEXT_TOO_LONG'],
    [{ id: ID, rating: 5, snapshot: { ...snapshot(), lang: 'de' } }, 'BAD_SNAPSHOT'],
  ]) {
    assert.equal(parseFeedback(raw, { catalog }).error, error, error);
  }
  assert.equal(cleanFeedbackText('<b>oi</b>'), '<b>oi</b>'); // texto simples: o painel mostra como texto
});

test('nota substitui a anterior do mesmo codigo; apagar o codigo apaga a nota e desconta os totais', async () => {
  const repo = new InMemoryRepo();
  const send = (rating, text, id = ID, when = NOW) =>
    submitFeedback(repo, { value: parseFeedback({ id, rating, text, snapshot: snapshot({ lessonsCompleted: 3 }) }, { catalog }).value, now: when });

  assert.deepEqual(await send(2, 'confuso'), { replaced: false });
  assert.deepEqual(await send(5, 'melhorou', ID, new Date('2026-10-27T16:00:00Z')), { replaced: true });
  await send(4, 'outro aparelho', ID2);

  let total = await repo.getTelemetryAgg('FEEDBACK');
  assert.equal(total.fb_n, 2);
  assert.equal(total.fb_sum, 9);
  assert.equal(total.fb_r2, 0);
  assert.equal(total.fb_r5, 1);
  const all = await feedbackPage(repo, {});
  assert.deepEqual(all.items.map((i) => i.text), ['melhorou', 'outro aparelho']);
  assert.equal(JSON.stringify(all).includes(ID), false); // a lista nao leva o codigo
  assert.deepEqual((await feedbackPage(repo, { rating: 2 })).items, []);
  assert.deepEqual((await feedbackPage(repo, { rating: 5 })).items.map((i) => i.rating), [5]);

  await ingestTelemetry(repo, { batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')])), now: NOW });
  assert.deepEqual(await deleteTelemetry(repo, { id: ID }), { deleted: true, feedback: true });
  assert.equal(await repo.getTelemetryMeta(ID), null);
  assert.equal(await repo.getFeedback(ID), null);
  assert.deepEqual((await feedbackPage(repo, {})).items.map((i) => i.text), ['outro aparelho']);
  total = await repo.getTelemetryAgg('FEEDBACK');
  assert.equal(total.fb_n, 1);
  assert.equal(total.fb_sum, 4);
  // idempotente
  assert.deepEqual(await deleteTelemetry(repo, { id: ID }), { deleted: true, feedback: false });
});

test('lista de notas pagina da mais nova para a mais velha', async () => {
  const repo = new InMemoryRepo();
  for (let i = 0; i < 5; i += 1) {
    const id = `0b6a3c1e-5f2d-4a8b-9c7e-1d2f3a4b5c6${i}`;
    await submitFeedback(repo, {
      value: parseFeedback({ id, rating: (i % 5) + 1, text: `n${i}`, snapshot: snapshot() }, { catalog }).value,
      now: new Date(NOW.getTime() + i * 1000),
    });
  }
  const p1 = await feedbackPage(repo, { limit: 2 });
  assert.deepEqual(p1.items.map((i) => i.text), ['n4', 'n3']);
  const p2 = await feedbackPage(repo, { limit: 2, cursor: p1.cursor });
  assert.deepEqual(p2.items.map((i) => i.text), ['n2', 'n1']);
  const p3 = await feedbackPage(repo, { limit: 2, cursor: p2.cursor });
  assert.deepEqual(p3.items.map((i) => i.text), ['n0']);
  assert.equal(p3.cursor, null);
});

// ---------------------------------------------------------------------------
// rotas publicas
// ---------------------------------------------------------------------------

const post = (routeKey, data, extra = {}) => ({ routeKey, body: typeof data === 'string' ? data : JSON.stringify(data), ...extra });

test('rotas publicas: POST /v1/telemetry, DELETE /v1/telemetry/{id} e POST /v1/feedback, sem token', async () => {
  const repo = new InMemoryRepo();
  const logs = [];
  const h = makeTelemetryHandlers({ repo, catalog, now: () => NOW, log: (...a) => logs.push(a.join(' ')) });
  assert.deepEqual(h.routeKeys, ['POST /v1/telemetry', 'DELETE /v1/telemetry/{id}', 'POST /v1/feedback']);

  let res = await h.telemetryRouter(post('POST /v1/telemetry', batch([ev('app_open', '2026-10-27T12:00:00Z'), ev('nada', '2026-10-27T12:00:00Z')])));
  assert.equal(res.statusCode, 200);
  // a resposta nao devolve dado nenhum para o app, so contagens
  assert.deepEqual(JSON.parse(res.body), { accepted: 1, dropped: 1 });

  res = await h.telemetryRouter(post('POST /v1/telemetry', { ...batch([ev('app_open', '2026-10-27T12:00:00Z')]), id: 'x' }));
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'BAD_ID');

  res = await h.telemetryRouter(post('POST /v1/telemetry', 'x'.repeat(17 * 1024)));
  assert.equal(res.statusCode, 413);

  // corpo do sendBeacon (text/plain) e o mesmo JSON
  res = await h.telemetryRouter(post('POST /v1/feedback', { id: ID, rating: 5, text: 'bom', snapshot: snapshot() }, { headers: { 'content-type': 'text/plain;charset=UTF-8' } }));
  assert.equal(res.statusCode, 200);
  res = await h.telemetryRouter(post('POST /v1/feedback', { id: ID, rating: 9, snapshot: snapshot() }));
  assert.equal(res.statusCode, 400);

  res = await h.telemetryRouter({ routeKey: 'DELETE /v1/telemetry/{id}', pathParameters: { id: 'nao-e-uuid' } });
  assert.equal(res.statusCode, 400);
  res = await h.telemetryRouter({ routeKey: 'DELETE /v1/telemetry/{id}', pathParameters: { id: ID } });
  assert.equal(res.statusCode, 200);
  assert.equal(await repo.getTelemetryMeta(ID), null);
  assert.equal(await repo.getFeedback(ID), null);
  assert.equal(logs.some((l) => l.includes(ID)), false); // o log nao leva o codigo

  res = await h.telemetryRouter({ routeKey: 'GET /v1/telemetry' });
  assert.equal(res.statusCode, 404);
});

// ---------------------------------------------------------------------------
// painel
// ---------------------------------------------------------------------------

test('buildUsage: ativos por tipo, retencao, funil, licoes, alcance na ordem do curso e notas', () => {
  const dayItems = [
    { key: 'DAY#2026-10-27', active_guest: 3, active_account: 1, 'ev:lesson_open': 4, 'ev:lesson_complete': 3, 'plat:android:twa': 2, 'plat:desktop:browser': 2, 'lang:en': 1, 'goal:20': 1, fb_n: 2, fb_sum: 9 },
    { key: 'DAY#2026-10-19', f_open: 10, ret1: 4, ret7: 2, f_onboarding: 9, f_lesson1: 7, f_lesson5: 3, f_account: 1 },
    { key: 'DAY#2026-10-26', f_open: 5, ret1: 0 },
    { key: 'DAY#2026-10-27#L#u1-l1', open: 3, done: 2, abandon: 1, sec: 200, timed: 2, score: 160, 'at:3': 1 },
    { key: 'DAY#2026-10-26#L#u1-l1', open: 1, done: 1, sec: 100, timed: 1, score: 80 },
    { key: 'DAY#2026-09-01', active_guest: 99 }, // fora da janela
  ];
  const u = buildUsage({
    dayItems,
    weekItems: [{ key: 'WEEK#2026-w44', active_guest: 5, active_account: 2 }],
    monthItems: [{ key: 'MONTH#2026-10', active_guest: 8, active_account: 3 }],
    reachItem: { key: 'REACH', 'done:u1-l2': 4, 'done:u1-l1': 9 },
    feedbackItem: { key: 'FEEDBACK', fb_n: 4, fb_sum: 15, fb_r3: 1, fb_r4: 1, fb_r5: 2 },
    today: '2026-10-27',
    labels: { lessons: { 'u1-l1': { title: 'Letras A a E', unitId: 'u1', unitTitle: 'Alfabeto' }, 'u1-l2': { title: 'Letras F a J', unitId: 'u1', unitTitle: 'Alfabeto' } } },
  });
  assert.deepEqual(u.active, { day: { guest: 3, account: 1, total: 4 }, week: { guest: 5, account: 2, total: 7 }, month: { guest: 8, account: 3, total: 11 } });
  assert.equal(u.days.length, 30);
  assert.deepEqual(u.retention.d1, { cohortSize: 10, returned: 4, rate: 0.4 }); // 26/10 ainda nao tem D1
  assert.deepEqual(u.retention.d7, { cohortSize: 10, returned: 2, rate: 0.2 });
  const c26 = u.retention.cohorts.find((c) => c.day === '2026-10-26');
  assert.equal(c26.d1, null);
  assert.deepEqual(u.funnel.map((s) => [s.key, s.count]), [['app_open', 15], ['onboarding_done', 9], ['first_lesson', 7], ['five_lessons', 3], ['account_created', 1]]);
  assert.equal(u.funnel[2].rate, 0.467);
  assert.deepEqual(u.lessons[0], {
    lessonId: 'u1-l1', title: 'Letras A a E', unitId: 'u1', unitTitle: 'Alfabeto', opens: 4, completes: 3, abandons: 1,
    completionRate: 0.75, abandonRate: 0.25, avgDurationSec: 100, avgScore: 0.8, abandonAt: [{ index: 3, count: 1 }],
  });
  assert.deepEqual(u.reach.map((r) => [r.lessonId, r.ids]), [['u1-l1', 9], ['u1-l2', 4]]);
  assert.deepEqual(u.platforms[0], { platform: 'android', installed: 'twa', activeDays: 2 });
  assert.deepEqual(u.onboarding.langs, [{ lang: 'en', count: 1 }]);
  assert.equal(u.feedback.average, 3.75);
  assert.deepEqual(u.feedback.distribution.map((d) => d.count), [0, 0, 1, 1, 2]);
  assert.equal(u.days.at(-1).feedbackAverage, 4.5);
});

const ADMIN = '11111111-1111-4111-8111-111111111111';
const adminEvent = (routeKey, query, groups = '[admin]') => ({
  routeKey,
  requestContext: { authorizer: { jwt: { claims: { sub: ADMIN, 'cognito:groups': groups } } } },
  queryStringParameters: query,
});

test('painel: GET /v1/admin/usage e /v1/admin/feedback, so admin, sem Scan', async () => {
  const repo = new InMemoryRepo();
  await ingestTelemetry(repo, { batch: parsed(batch([ev('app_open', '2026-10-27T12:00:00Z')])), now: NOW });
  await submitFeedback(repo, { value: parseFeedback({ id: ID, rating: 3, text: '<img src=x onerror=alert(1)>', snapshot: snapshot() }, { catalog }).value, now: NOW });
  const { adminRouter } = makeAdminHandlers({ repo, directory: {}, mfa: false, liveGroups: false, now: () => NOW, log: () => {} });

  assert.equal((await adminRouter(adminEvent('GET /v1/admin/usage', undefined, '[]'))).statusCode, 403);
  const usage = JSON.parse((await adminRouter(adminEvent('GET /v1/admin/usage'))).body);
  assert.equal(usage.active.day.guest, 1);
  assert.equal(usage.feedback.count, 1);

  const fb = JSON.parse((await adminRouter(adminEvent('GET /v1/admin/feedback', { rating: '3' }))).body);
  assert.equal(fb.items.length, 1);
  assert.equal(fb.items[0].text, '<img src=x onerror=alert(1)>'); // texto cru: o painel mostra como texto
  for (const query of [{ rating: '0' }, { rating: 'x' }, { limit: '500' }, { cursor: 'bad' }]) {
    assert.equal((await adminRouter(adminEvent('GET /v1/admin/feedback', query))).statusCode, 400, JSON.stringify(query));
  }

  // so leitura por chave e Query (o repo em memoria nao tem Scan; o painel tambem nao)
  const usage2 = await usageOverview(repo, { now: NOW });
  assert.equal(usage2.today, '2026-10-27');
});

test('DynamoRepo: item do codigo com trava otimista, lista por Query decrescente e agregados em TELAGG', async () => {
  const calls = [];
  const db = {
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'QueryCommand') return { Items: [{ PK: 'FBLIST#R5', SK: 's1', rating: 5, expiresAt: 1 }], LastEvaluatedKey: { PK: 'FBLIST#R5', SK: 's1' } };
      return {};
    },
  };
  const repo = new DynamoRepo(db);
  await repo.putTelemetryMeta(ID, { rev: 1 }, { expectedRev: null });
  assert.equal(calls[0].input.Item.PK, `TEL#${ID}`);
  assert.equal(calls[0].input.Item.SK, 'META');
  assert.equal(calls[0].input.ConditionExpression, 'attribute_not_exists(PK)');
  await repo.putTelemetryMeta(ID, { rev: 3 }, { expectedRev: 2 });
  assert.equal(calls[1].input.ConditionExpression, '#rev = :rev');
  assert.deepEqual(calls[1].input.ExpressionAttributeValues, { ':rev': 2 });

  const page = await repo.listFeedbackEntries('FBLIST#R5', { limit: 10, cursor: 's0' });
  assert.deepEqual(page, { entries: [{ rating: 5 }], cursor: 's1' });
  assert.equal(calls[2].input.ScanIndexForward, false);
  assert.deepEqual(calls[2].input.ExclusiveStartKey, { PK: 'FBLIST#R5', SK: 's0' });

  await repo.addTelemetryCounters('DAY#2026-10-27', { active_guest: 1 }, { expiresAt: 5 });
  assert.equal(calls[3].input.Key.PK, 'TELAGG');
  assert.match(calls[3].input.UpdateExpression, /^ADD #c0 :c0 SET expiresAt = if_not_exists\(expiresAt, :exp\)$/);

  await repo.deleteTelemetryItems(ID);
  assert.deepEqual(calls.slice(4).map((c) => c.input.Key), [{ PK: `TEL#${ID}`, SK: 'META' }, { PK: `TEL#${ID}`, SK: 'FEEDBACK' }]);
  assert.equal(calls.some((c) => c.name === 'ScanCommand'), false);
});
