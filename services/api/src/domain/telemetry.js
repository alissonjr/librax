import { addDays, daysBetween } from '../lib/dates.js';
import { DAY_RETENTION_DAYS, WEEK_RETENTION_DAYS, freshPeriods, opsExpiry, periodsOf } from './opsMetrics.js';

// Dados de uso anonimos (docs/painel-admin.md, "Uso anonimo"). Via de mao unica: o app manda, o
// servidor soma e nada volta para o app. O codigo anonimo e um UUID aleatorio criado so para isso
// no navegador, separado da conta, do codigo do aparelho e do id local; e ele que liga os lotes de
// um mesmo acesso e serve de segredo para apagar a copia na nuvem.
//
//   TEL#<id> / META            um item por codigo: primeiro e ultimo dia, contagens por evento,
//                              licoes abertas e concluidas, marcos do funil, ultimo retrato e
//                              has_account. TTL de 12 meses depois da ultima atividade.
//   TEL#<id> / FEEDBACK        a nota e o comentario (domain/feedback.js), mesmo TTL
//   TELAGG / DAY#<dia>         somas do dia: ativos por tipo (convidado ou conta), eventos, codigos
//                              novos e, no dia do primeiro acesso (coorte), D1, D7 e o funil
//   TELAGG / DAY#<dia>#L#<licao>  aberturas, conclusoes, saidas, tempo, nota e onde saiu (um item
//                              pequeno por licao e dia: cada soma custa 1 unidade de escrita)
//   TELAGG / WEEK#<semana>     ativos por tipo na semana (ISO, a mesma das ligas)
//   TELAGG / MONTH#<mes>       ativos por tipo no mes
//   TELAGG / REACH             quantos codigos ja concluiram cada licao (ate onde chegam no curso)
//
// Tudo e somado na escrita (ADD), entao o painel le poucos itens por chave, sem Scan. Os nomes dos
// contadores sao planos (`done:u1-l1`), como em domain/opsMetrics.js.

export const TELEMETRY_VERSION = 1;
/** Eventos por lote e corpo maximo (o app manda lotes bem menores). */
export const TELEMETRY_MAX_EVENTS = 50;
export const TELEMETRY_MAX_BODY_BYTES = 16 * 1024;
/** Janela aceita para o horario de cada evento: a fila offline do app guarda no maximo 30 dias. */
export const EVENT_MAX_AGE_DAYS = 30;
/** Relogio do aparelho adiantado: ate 1 dia. */
export const EVENT_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
/** O item de cada codigo expira 12 meses depois da ultima atividade. */
export const TELEMETRY_TTL_DAYS = 365;
/** Coortes extras lidas para o D7 cobrir 30 coortes inteiras (a mais nova com D7 pronto e de 8 dias atras). */
const RETENTION_EXTRA_DAYS = 8;

export const TELEMETRY_PK = 'TELAGG';
export const telKey = {
  id: (id) => `TEL#${id}`,
  day: (day) => `DAY#${day}`,
  lesson: (day, lessonId) => `DAY#${day}#L#${lessonId}`,
  week: (week) => `WEEK#${week}`,
  month: (month) => `MONTH#${month}`,
  reach: 'REACH',
  feedback: 'FEEDBACK',
};

export const EVENT_TYPES = [
  'app_open',
  'onboarding_done',
  'lesson_open',
  'lesson_complete',
  'lesson_abandon',
  'daily_goal_met',
  'placement_started',
  'placement_done',
  'practice_done',
  'account_created',
];
export const LANGS = ['pt-BR', 'en', 'es'];
export const PLATFORMS = ['android', 'ios', 'desktop', 'other'];
export const INSTALLS = ['browser', 'pwa', 'twa'];
export const PRACTICE_MODES = ['review', 'free'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION_RE = /^[0-9A-Za-z._:+-]{1,40}$/;
const DAY_S = 24 * 60 * 60;
const DAY_MS = DAY_S * 1000;

/** Codigo anonimo: UUID v4 em minusculas (crypto.randomUUID). */
export const isTelemetryId = (id) => typeof id === 'string' && UUID_RE.test(id);

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj ?? {}, key);
const isLesson = (catalog, id) => typeof id === 'string' && has(catalog.lessons, id);

/** Dia local do aparelho para um horario (ms) e o deslocamento do fuso (getTimezoneOffset, minutos). */
export function localDay(at, tzOffsetMin) {
  return new Date(at - tzOffsetMin * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Retrato do progresso que vai em cada lote (e na nota, domain/feedback.js). Tudo obrigatorio e
 * conferido; nada alem destes campos e guardado.
 */
export function parseSnapshot(raw, catalog) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'BAD_SNAPSHOT' };
  const s = raw;
  if (!isInt(s.lessonsCompleted, 0, 10000)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (!isInt(s.xpTotal, 0, 10_000_000)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (!isInt(s.streak, 0, 100_000)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (typeof s.hasAccount !== 'boolean') return { ok: false, error: 'BAD_SNAPSHOT' };
  if (!LANGS.includes(s.lang)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (!PLATFORMS.includes(s.platform)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (!INSTALLS.includes(s.installed)) return { ok: false, error: 'BAD_SNAPSHOT' };
  if (s.appVersion != null && !(typeof s.appVersion === 'string' && VERSION_RE.test(s.appVersion))) {
    return { ok: false, error: 'BAD_SNAPSHOT' };
  }
  if (s.currentLessonId != null && !isLesson(catalog, s.currentLessonId)) return { ok: false, error: 'BAD_SNAPSHOT' };
  return {
    ok: true,
    value: {
      lessonsCompleted: s.lessonsCompleted,
      xpTotal: s.xpTotal,
      streak: s.streak,
      currentLessonId: s.currentLessonId ?? null,
      hasAccount: s.hasAccount,
      appVersion: s.appVersion ?? null,
      lang: s.lang,
      platform: s.platform,
      installed: s.installed,
    },
  };
}

/**
 * Um evento: tipo da lista, horario dentro da janela e os campos do tipo, cada um conferido. Volta
 * `null` para evento fora do formato (o lote segue sem ele).
 */
export function parseEvent(raw, { catalog, nowMs, tz }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { type, at } = raw;
  if (!EVENT_TYPES.includes(type)) return null;
  if (!Number.isInteger(at) || at < nowMs - EVENT_MAX_AGE_DAYS * DAY_MS || at > nowMs + EVENT_MAX_FUTURE_MS) return null;
  const base = { type, at, day: localDay(at, tz) };
  switch (type) {
    case 'app_open':
    case 'daily_goal_met':
    case 'account_created':
      return base;
    case 'onboarding_done':
      if (!LANGS.includes(raw.lang) || !isInt(raw.dailyGoal, 1, 200)) return null;
      return { ...base, lang: raw.lang, dailyGoal: raw.dailyGoal };
    case 'lesson_open':
      return isLesson(catalog, raw.lessonId) ? { ...base, lessonId: raw.lessonId } : null;
    case 'lesson_complete': {
      if (!isLesson(catalog, raw.lessonId)) return null;
      if (typeof raw.score !== 'number' || !(raw.score >= 0 && raw.score <= 1)) return null;
      if (!isInt(raw.xp, 0, 1000)) return null;
      if (raw.durationSec != null && !isInt(raw.durationSec, 0, 6 * 60 * 60)) return null;
      return { ...base, lessonId: raw.lessonId, score: raw.score, xp: raw.xp, durationSec: raw.durationSec ?? null };
    }
    case 'lesson_abandon':
      if (!isLesson(catalog, raw.lessonId)) return null;
      if (!isInt(raw.exerciseCount, 1, 200) || !isInt(raw.exerciseIndex, 0, raw.exerciseCount - 1)) return null;
      return { ...base, lessonId: raw.lessonId, exerciseIndex: raw.exerciseIndex, exerciseCount: raw.exerciseCount };
    case 'placement_started':
      return typeof raw.camera === 'boolean' ? { ...base, camera: raw.camera } : null;
    case 'placement_done':
      return isInt(raw.placed, 0, 200) ? { ...base, placed: raw.placed } : null;
    case 'practice_done':
      if (!PRACTICE_MODES.includes(raw.mode) || !isInt(raw.items, 1, 100) || !isInt(raw.correct, 0, raw.items)) return null;
      return { ...base, mode: raw.mode, items: raw.items, correct: raw.correct };
    default:
      return null;
  }
}

/**
 * Lote do app (POST /v1/telemetry): `{ v, id, tz, snapshot, events }`. Envelope errado recusa o lote
 * inteiro; evento fora do formato ou da janela de horario sai sozinho (`dropped`).
 */
export function parseTelemetryBatch(raw, { catalog, now }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'BAD_BATCH' };
  if (raw.v !== TELEMETRY_VERSION) return { ok: false, error: 'BAD_VERSION' };
  if (!isTelemetryId(raw.id)) return { ok: false, error: 'BAD_ID' };
  if (!isInt(raw.tz, -840, 840)) return { ok: false, error: 'BAD_TZ' };
  if (!Array.isArray(raw.events) || raw.events.length === 0) return { ok: false, error: 'NO_EVENTS' };
  if (raw.events.length > TELEMETRY_MAX_EVENTS) return { ok: false, error: 'TOO_MANY_EVENTS' };
  const snapshot = parseSnapshot(raw.snapshot, catalog);
  if (!snapshot.ok) return snapshot;
  const nowMs = now.getTime();
  const events = raw.events.map((e) => parseEvent(e, { catalog, nowMs, tz: raw.tz })).filter(Boolean);
  return {
    ok: true,
    value: { id: raw.id, tz: raw.tz, snapshot: snapshot.value, events },
    dropped: raw.events.length - events.length,
  };
}

/** Comecou do zero (sem licao, XP nem conta): so esses entram no funil e na retencao. */
const freshStart = (snapshot) => snapshot.lessonsCompleted === 0 && snapshot.xpTotal === 0 && !snapshot.hasAccount;

const MILESTONES = ['onboarding', 'lesson1', 'lesson5', 'account'];

/**
 * O que um lote muda: o item novo do codigo e as somas (ADD) nos itens agregados.
 *
 * - Ativo: cada dia dos eventos ainda nao contado para o codigo soma no dia (e na semana e no mes,
 *   se forem novos), separado em `active_guest` e `active_account` pelo has_account do retrato.
 * - Codigo novo: `newIds` no dia do primeiro evento; se comecou do zero (`fresh`), entra na coorte
 *   desse dia (`f_open`) e conta para o D1 e o D7 (`ret1`, `ret7`: ativo 1 ou 7 dias depois) e
 *   para o funil (`f_onboarding`, `f_lesson1`, `f_lesson5`, `f_account`), uma vez cada.
 * - Licoes: por dia e licao em `DAY#<dia>#L#<licao>`; a primeira conclusao de cada licao pelo codigo soma em
 *   `REACH`.
 *
 * @param {object} input { old: item atual ou null, batch: parseTelemetryBatch().value, now: Date }
 * @returns {{ item: object, writes: Array<{key: string, counters: object, expiresAt: number|null}> }}
 */
export function planTelemetry({ old, batch, now }) {
  const { snapshot, events } = batch;
  const ordered = [...events].sort((a, b) => a.at - b.at);
  const days = [...new Set(ordered.map((e) => e.day))].sort();
  const item = old
    ? structuredClone(old)
    : {
        firstDay: days[0],
        fresh: freshStart(snapshot),
        lastDay: null,
        lastWeek: null,
        lastMonth: null,
        counts: {},
        opened: [],
        completed: [],
        milestones: {},
      };
  item.counts ??= {};
  item.opened ??= [];
  item.completed ??= [];
  item.milestones ??= {};
  item.rev = (old?.rev ?? 0) + 1;

  const writes = new Map();
  const add = (key, name, n, expiresAt) => {
    if (!n) return;
    const w = writes.get(key) ?? { key, counters: {}, expiresAt };
    w.counters[name] = (w.counters[name] ?? 0) + n;
    writes.set(key, w);
  };
  const addDay = (day, name, n = 1) => add(telKey.day(day), name, n, opsExpiry(day, DAY_RETENTION_DAYS));
  const addLesson = (day, lessonId, name, n = 1) => add(telKey.lesson(day, lessonId), name, n, opsExpiry(day, DAY_RETENTION_DAYS));
  const cohort = item.fresh ? item.firstDay : null;

  if (!old) {
    addDay(item.firstDay, 'newIds');
    if (cohort) addDay(cohort, 'f_open');
  }

  const kind = snapshot.hasAccount ? 'active_account' : 'active_guest';
  for (const day of days) {
    const periods = periodsOf(day);
    const fresh = freshPeriods({ lastDay: item.lastDay, lastWeek: item.lastWeek, lastMonth: item.lastMonth }, periods);
    if (!fresh.day) continue;
    addDay(day, kind);
    addDay(day, `plat:${snapshot.platform}:${snapshot.installed}`);
    if (fresh.week) add(telKey.week(periods.week), kind, 1, opsExpiry(day, WEEK_RETENTION_DAYS));
    if (fresh.month) add(telKey.month(periods.month), kind, 1, null);
    if (cohort) {
      const gap = daysBetween(day, cohort);
      if (gap === 1) addDay(cohort, 'ret1');
      if (gap === 7) addDay(cohort, 'ret7');
    }
    item.lastDay = day;
    item.lastWeek = periods.week;
    item.lastMonth = periods.month;
  }

  const reached = new Set();
  for (const e of ordered) {
    item.counts[e.type] = (item.counts[e.type] ?? 0) + 1;
    addDay(e.day, `ev:${e.type}`);
    switch (e.type) {
      case 'lesson_open':
        addLesson(e.day, e.lessonId, 'open');
        if (!item.opened.includes(e.lessonId)) item.opened.push(e.lessonId);
        break;
      case 'lesson_complete':
        addLesson(e.day, e.lessonId, 'done');
        addLesson(e.day, e.lessonId, 'score', Math.round(e.score * 100));
        if (e.durationSec != null) {
          addLesson(e.day, e.lessonId, 'sec', e.durationSec);
          addLesson(e.day, e.lessonId, 'timed');
        }
        if (!item.completed.includes(e.lessonId)) {
          item.completed.push(e.lessonId);
          reached.add(e.lessonId);
        }
        break;
      case 'lesson_abandon':
        addLesson(e.day, e.lessonId, 'abandon');
        addLesson(e.day, e.lessonId, `at:${e.exerciseIndex}`);
        break;
      case 'onboarding_done':
        addDay(e.day, `lang:${e.lang}`);
        addDay(e.day, `goal:${e.dailyGoal}`);
        break;
      case 'placement_done':
        addDay(e.day, 'placementPlaced', e.placed);
        break;
      case 'practice_done':
        addDay(e.day, `practice:${e.mode}`);
        addDay(e.day, 'practiceItems', e.items);
        addDay(e.day, 'practiceCorrect', e.correct);
        break;
      default:
        break;
    }
  }
  for (const lessonId of reached) add(telKey.reach, `done:${lessonId}`, 1, null);

  // Marcos do funil, uma vez por codigo
  const done = Math.max(item.completed.length, snapshot.lessonsCompleted);
  const reachedMilestone = {
    onboarding: (item.counts.onboarding_done ?? 0) > 0,
    lesson1: done >= 1,
    lesson5: done >= 5,
    account: snapshot.hasAccount || (item.counts.account_created ?? 0) > 0,
  };
  const lastDay = days.at(-1) ?? item.firstDay;
  for (const m of MILESTONES) {
    if (!reachedMilestone[m] || item.milestones[m]) continue;
    item.milestones[m] = lastDay;
    if (cohort) addDay(cohort, `f_${m}`);
  }

  const nowS = Math.floor(now.getTime() / 1000);
  item.snapshot = snapshot;
  item.hasAccount = snapshot.hasAccount;
  item.lastAt = now.toISOString();
  item.expiresAt = nowS + TELEMETRY_TTL_DAYS * DAY_S;
  return { item, writes: [...writes.values()] };
}

// ---------------------------------------------------------------------------
// Leitura: a tela "Uso" do painel
// ---------------------------------------------------------------------------

const DAY_KEY_RE = /^DAY#(\d{4}-\d{2}-\d{2})(?:#L#(.+))?$/;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
const avg = (sum, n) => (n > 0 ? Math.round((sum / n) * 100) / 100 : null);

/** Soma os contadores `prefixo:resto` de um item em `into[resto]`. */
function sumPrefixed(item, prefix, into) {
  for (const [name, value] of Object.entries(item)) {
    if (typeof value !== 'number' || !name.startsWith(`${prefix}:`)) continue;
    const rest = name.slice(prefix.length + 1);
    into[rest] = (into[rest] ?? 0) + value;
  }
}

/** Dias que a tela "Uso" le: a janela e mais 8 dias de coortes para o D7. */
export function usageRange(today, days) {
  return { from: addDays(today, -(days - 1)), readFrom: addDays(today, -(days - 1 + RETENTION_EXTRA_DAYS)) };
}

/** Nota: contagem por estrela, total e media de um item com os contadores `fb_*`. */
export function feedbackStats(item) {
  const distribution = [1, 2, 3, 4, 5].map((r) => ({ rating: r, count: num(item?.[`fb_r${r}`]) }));
  const count = num(item?.fb_n);
  return { count, average: avg(num(item?.fb_sum), count), distribution };
}

/**
 * Tela "Uso" (GET /v1/admin/usage).
 * @param {object} input
 *   dayItems:   DAY#... de readFrom ate hoje (com `key`), inclusive os de licao (#L#<licao>)
 *   weekItems, monthItems: WEEK#..., MONTH#...
 *   reachItem:  REACH (ou null); feedbackItem: FEEDBACK (ou null)
 *   today, days, labels: { lessons: { [id]: { title, unitId, unitTitle } } } na ordem do curso
 */
export function buildUsage({ dayItems = [], weekItems = [], monthItems = [], reachItem = null, feedbackItem = null, today, days = 30, labels = {} }) {
  const { from, readFrom } = usageRange(today, days);
  const totalsByDay = new Map();
  const lessons = {};
  for (const item of dayItems) {
    const m = DAY_KEY_RE.exec(item.key ?? '');
    if (!m || m[1] < readFrom || m[1] > today) continue;
    if (!m[2]) totalsByDay.set(m[1], item);
    else if (m[1] >= from) {
      const lesson = (lessons[m[2]] ??= { at: {} });
      for (const metric of ['open', 'done', 'abandon', 'sec', 'timed', 'score']) lesson[metric] = (lesson[metric] ?? 0) + num(item[metric]);
      const at = {};
      sumPrefixed(item, 'at', at);
      for (const [index, n] of Object.entries(at)) {
        if (!/^\d+$/.test(index)) continue;
        lesson.at[index] = (lesson.at[index] ?? 0) + n;
      }
    }
  }

  const get = (day) => totalsByDay.get(day) ?? {};
  const series = [];
  const events = {};
  const langs = {};
  const goals = {};
  const platforms = {};
  const practice = { review: 0, free: 0, items: 0, correct: 0 };
  let placementPlaced = 0;
  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    const t = get(day);
    series.push({
      day,
      guest: num(t.active_guest),
      account: num(t.active_account),
      newIds: num(t.newIds),
      lessonOpens: num(t['ev:lesson_open']),
      lessonsCompleted: num(t['ev:lesson_complete']),
      feedbackCount: num(t.fb_n),
      feedbackAverage: avg(num(t.fb_sum), num(t.fb_n)),
    });
    sumPrefixed(t, 'ev', events);
    sumPrefixed(t, 'lang', langs);
    sumPrefixed(t, 'goal', goals);
    sumPrefixed(t, 'plat', platforms);
    practice.review += num(t['practice:review']);
    practice.free += num(t['practice:free']);
    practice.items += num(t.practiceItems);
    practice.correct += num(t.practiceCorrect);
    placementPlaced += num(t.placementPlaced);
  }

  // Coortes: quem chegou com o app zerado em cada dia, e quantos voltaram 1 e 7 dias depois
  const cohort = (day) => {
    const t = get(day);
    const size = num(t.f_open);
    const d1Ready = daysBetween(today, day) >= 2;
    const d7Ready = daysBetween(today, day) >= 8;
    return {
      day,
      size,
      d1: d1Ready ? num(t.ret1) : null,
      d7: d7Ready ? num(t.ret7) : null,
      d1Rate: d1Ready ? ratio(num(t.ret1), size) : null,
      d7Rate: d7Ready ? ratio(num(t.ret7), size) : null,
    };
  };
  const cohorts = series.map((d) => cohort(d.day));
  const rateOver = (field, offset) => {
    let size = 0;
    let back = 0;
    for (let i = 0; i < days; i += 1) {
      const day = addDays(today, -(offset + i));
      const t = get(day);
      size += num(t.f_open);
      back += num(t[field]);
    }
    return { cohortSize: size, returned: back, rate: ratio(back, size) };
  };

  const funnelSum = (field) => series.reduce((acc, d) => acc + num(get(d.day)[field]), 0);
  const funnel = [
    { key: 'app_open', count: funnelSum('f_open') },
    { key: 'onboarding_done', count: funnelSum('f_onboarding') },
    { key: 'first_lesson', count: funnelSum('f_lesson1') },
    { key: 'five_lessons', count: funnelSum('f_lesson5') },
    { key: 'account_created', count: funnelSum('f_account') },
  ].map((step, i, all) => ({ ...step, rate: i === 0 ? (step.count > 0 ? 1 : null) : ratio(step.count, all[0].count) }));

  const label = (lessonId) => labels.lessons?.[lessonId] ?? {};
  const lessonRows = Object.entries(lessons)
    .map(([lessonId, c]) => {
      const opens = num(c.open);
      const completes = num(c.done);
      const abandons = num(c.abandon);
      const abandonAt = Object.entries(c.at)
        .map(([index, count]) => ({ index: Number(index), count }))
        .sort((a, b) => b.count - a.count || a.index - b.index)
        .slice(0, 3);
      return {
        lessonId,
        title: label(lessonId).title ?? null,
        unitId: label(lessonId).unitId ?? null,
        unitTitle: label(lessonId).unitTitle ?? null,
        opens,
        completes,
        abandons,
        completionRate: ratio(completes, opens),
        abandonRate: ratio(abandons, completes + abandons),
        avgDurationSec: c.timed ? Math.round(num(c.sec) / num(c.timed)) : null,
        avgScore: completes > 0 ? Math.round(num(c.score) / completes) / 100 : null,
        abandonAt,
      };
    })
    .sort((a, b) => b.opens - a.opens || (a.lessonId < b.lessonId ? -1 : 1));

  const reachCounts = {};
  sumPrefixed(reachItem ?? {}, 'done', reachCounts);
  const order = Object.keys(labels.lessons ?? {});
  for (const id of Object.keys(reachCounts)) if (!order.includes(id)) order.push(id);
  const reach = order
    .map((lessonId, position) => ({
      lessonId,
      position: position + 1,
      title: label(lessonId).title ?? null,
      unitId: label(lessonId).unitId ?? null,
      unitTitle: label(lessonId).unitTitle ?? null,
      ids: num(reachCounts[lessonId]),
    }));

  const periodRows = (items, prefix, name, count) =>
    items
      .filter((i) => typeof i.key === 'string' && i.key.startsWith(prefix))
      .map((i) => ({
        [name]: i.key.slice(prefix.length),
        guest: num(i.active_guest),
        account: num(i.active_account),
        feedbackCount: num(i.fb_n),
        feedbackAverage: avg(num(i.fb_sum), num(i.fb_n)),
      }))
      .sort((a, b) => (a[name] < b[name] ? -1 : 1))
      .slice(-count);
  const weeks = periodRows(weekItems, 'WEEK#', 'week', 12);
  const months = periodRows(monthItems, 'MONTH#', 'month', 12);
  const { week: thisWeek, month: thisMonth } = periodsOf(today);
  const split = (row) => ({ guest: row?.guest ?? 0, account: row?.account ?? 0, total: (row?.guest ?? 0) + (row?.account ?? 0) });

  const lastDay = series.at(-1);
  return {
    today,
    range: { from, to: today },
    active: {
      day: split(lastDay),
      week: split(weeks.find((w) => w.week === thisWeek)),
      month: split(months.find((m) => m.month === thisMonth)),
    },
    newIds: series.reduce((acc, d) => acc + d.newIds, 0),
    days: series,
    weeks,
    months,
    retention: {
      d1: rateOver('ret1', 2),
      d7: rateOver('ret7', 8),
      cohorts,
    },
    funnel,
    events: Object.fromEntries(EVENT_TYPES.map((t) => [t, num(events[t])])),
    lessons: lessonRows,
    reach,
    onboarding: {
      langs: Object.entries(langs).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count),
      goals: Object.entries(goals).map(([goal, count]) => ({ goal: Number(goal), count })).sort((a, b) => a.goal - b.goal),
    },
    platforms: Object.entries(platforms)
      .map(([key, activeDays]) => {
        const [platform, installed] = key.split(':');
        return { platform, installed, activeDays };
      })
      .sort((a, b) => b.activeDays - a.activeDays),
    practice: { ...practice, accuracy: ratio(practice.correct, practice.items) },
    placementPlaced,
    feedback: feedbackStats(feedbackItem),
  };
}
