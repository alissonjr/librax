import { addDays, parseIsoDate } from '../lib/dates.js';
import { periodKey, periodStartOf } from './leagues.js';
import { localClock } from './reminders.js';

// Contadores agregados do painel de administracao (docs/painel-admin.md).
//
// O painel nunca varre a tabela: cada evento que ja passa pelo servidor (licao concluida, pratica,
// saida da licao, conta nova) soma com ADD em poucos itens por dia, e a tela le so esses itens.
//
//   OPS / DAY#<dia>            totais do dia (ativos, contas novas, licoes, pratica, saidas)
//                              e, gravado pelo job diario, `cloud` (erros e 5xx do CloudWatch)
//   OPS / DAY#<dia>#LESSON     por licao: done, abandon, attempted, wrong, failedSigns, reviewedSigns
//   OPS / DAY#<dia>#EXERCISE   por tipo de exercicio: attempted, wrong, abandon
//   OPS / DAY#<dia>#SIGN       por sinal: failed
//   OPS / WEEK#<AAAA-wSS>      ativos, contas novas e licoes da semana (ISO, segunda a domingo)
//   OPS / MONTH#<AAAA-MM>      ativos, contas novas e licoes do mes
//   OPS / COST#<AAAA-MM>       custo do mes (Cost Explorer, uma vez por dia)
//   USER#<id> / ACTIVITY       ultimo dia, semana e mes em que a pessoa contou como ativa
//
// O dia e o da pessoa (`today` da conclusao, o mesmo da ofensiva). Conta nova usa o dia de
// Brasilia (OPS_TIME_ZONE), porque o Cognito nao manda o fuso de quem se cadastrou.
// Os nomes dos contadores por item sao planos (`done:u1-l1`): o ADD do DynamoDB nao cria mapa
// aninhado que ainda nao existe.

export const OPS_TIME_ZONE = 'America/Sao_Paulo';
/** Dias guardados (TTL): um ano e um pouco, para comparar com o mesmo mes do ano anterior. */
export const DAY_RETENTION_DAYS = 400;
export const WEEK_RETENTION_DAYS = 800;
/** Janela da tela de operacao. */
export const OVERVIEW_DAYS = 30;
export const OVERVIEW_WEEKS = 12;
export const OVERVIEW_MONTHS = 12;

const DAY_S = 24 * 60 * 60;
const NOON_MS = 12 * 60 * 60 * 1000;

export const opsKey = {
  day: (day) => `DAY#${day}`,
  dayPart: (day, part) => `DAY#${day}#${part}`,
  week: (week) => `WEEK#${week}`,
  month: (month) => `MONTH#${month}`,
  cost: (month) => `COST#${month}`,
};

/** Dia, semana ISO ('AAAA-wSS', a mesma das ligas) e mes de um dia 'YYYY-MM-DD'. */
export function periodsOf(day) {
  return {
    day,
    week: periodKey(periodStartOf(parseIsoDate(day) + NOON_MS)),
    month: day.slice(0, 7),
  };
}

/** Dia de hoje no fuso do painel. */
export function opsToday(now) {
  return localClock(now, OPS_TIME_ZONE).day;
}

/** TTL (epoch em segundos) contado a partir do proprio dia, nao da gravacao. */
export function opsExpiry(day, retentionDays) {
  return Math.floor(parseIsoDate(day) / 1000) + retentionDays * DAY_S;
}

/**
 * O que ja foi contado: compara o registro de atividade da pessoa com os periodos do evento.
 * Evento mais velho que o ultimo dia contado (relogio errado, fila antiga) nao conta de novo.
 * @returns {{day: boolean, week: boolean, month: boolean}}
 */
export function freshPeriods(activity, periods) {
  if (activity?.lastDay && activity.lastDay >= periods.day) return { day: false, week: false, month: false };
  return {
    day: true,
    week: !activity?.lastWeek || activity.lastWeek < periods.week,
    month: !activity?.lastMonth || activity.lastMonth < periods.month,
  };
}

const add = (target, name, n) => {
  if (n > 0) target[name] = (target[name] ?? 0) + n;
};

/** Escritas de um dia: totais e, se `fresh`, a pessoa conta como ativa no dia, semana e mes. */
function periodWrites(periods, totals, fresh, periodTotals = totals) {
  const writes = [{ key: opsKey.day(periods.day), counters: { ...totals }, expiresAt: opsExpiry(periods.day, DAY_RETENTION_DAYS) }];
  const week = { ...periodTotals };
  const month = { ...periodTotals };
  if (fresh.day) writes[0].counters.activeUsers = 1;
  if (fresh.week) week.activeUsers = 1;
  if (fresh.month) month.activeUsers = 1;
  if (Object.keys(week).length) {
    writes.push({ key: opsKey.week(periods.week), counters: week, expiresAt: opsExpiry(periods.day, WEEK_RETENTION_DAYS) });
  }
  if (Object.keys(month).length) writes.push({ key: opsKey.month(periods.month), counters: month, expiresAt: null });
  return writes;
}

/**
 * Escritas de uma licao concluida.
 * @param {object} input { lessonId, today, reviewed?, exerciseStats?, fresh }
 * @returns {Array<{key: string, counters: object, expiresAt: number|null}>}
 */
export function lessonCompletedWrites({ lessonId, today, reviewed = [], exerciseStats = null, fresh }) {
  const periods = periodsOf(today);
  const expiresAt = opsExpiry(today, DAY_RETENTION_DAYS);
  const writes = periodWrites(periods, { lessonsCompleted: 1 }, fresh);

  const lesson = { [`done:${lessonId}`]: 1 };
  const exercises = {};
  for (const [type, { attempted, wrong }] of Object.entries(exerciseStats ?? {})) {
    add(exercises, `attempted:${type}`, attempted);
    add(exercises, `wrong:${type}`, wrong);
    add(lesson, `attempted:${lessonId}`, attempted);
    add(lesson, `wrong:${lessonId}`, wrong);
  }
  const signs = {};
  const graded = reviewed.filter((r) => r.result?.state !== 'no_capture');
  add(lesson, `reviewedSigns:${lessonId}`, graded.length);
  for (const r of graded) {
    if (r.result.state === 'failed') {
      add(signs, `failed:${r.signId}`, 1);
      add(lesson, `failedSigns:${lessonId}`, 1);
    }
  }

  writes.push({ key: opsKey.dayPart(today, 'LESSON'), counters: lesson, expiresAt });
  if (Object.keys(exercises).length) writes.push({ key: opsKey.dayPart(today, 'EXERCISE'), counters: exercises, expiresAt });
  if (Object.keys(signs).length) writes.push({ key: opsKey.dayPart(today, 'SIGN'), counters: signs, expiresAt });
  return writes;
}

/** Escritas de uma rodada da pratica diaria. */
export function practiceWrites({ today, fresh }) {
  return periodWrites(periodsOf(today), { practiceSessions: 1 }, fresh, {});
}

/** Escritas de uma saida no meio da licao. */
export function lessonAbandonWrites({ lessonId, today, exerciseType = null, fresh }) {
  const expiresAt = opsExpiry(today, DAY_RETENTION_DAYS);
  const writes = periodWrites(periodsOf(today), { lessonAbandons: 1 }, fresh, {});
  writes.push({ key: opsKey.dayPart(today, 'LESSON'), counters: { [`abandon:${lessonId}`]: 1 }, expiresAt });
  if (exerciseType) {
    writes.push({ key: opsKey.dayPart(today, 'EXERCISE'), counters: { [`abandon:${exerciseType}`]: 1 }, expiresAt });
  }
  return writes;
}

/** Escritas de uma conta nova (gatilho PostConfirmation do Cognito). */
export function newAccountWrites({ day }) {
  const periods = periodsOf(day);
  return [
    { key: opsKey.day(day), counters: { newAccounts: 1 }, expiresAt: opsExpiry(day, DAY_RETENTION_DAYS) },
    { key: opsKey.week(periods.week), counters: { newAccounts: 1 }, expiresAt: opsExpiry(day, WEEK_RETENTION_DAYS) },
    { key: opsKey.month(periods.month), counters: { newAccounts: 1 }, expiresAt: null },
  ];
}

// ---------------------------------------------------------------------------
// Leitura: monta a tela de operacao a partir dos itens
// ---------------------------------------------------------------------------

const DAY_KEY_RE = /^DAY#(\d{4}-\d{2}-\d{2})(?:#(LESSON|EXERCISE|SIGN))?$/;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/** `{ 'done:u1-l1': 3, 'wrong:u1-l1': 1 }` -> `{ 'u1-l1': { done: 3, wrong: 1 } }` */
function unflatten(item, into) {
  for (const [name, value] of Object.entries(item)) {
    const i = name.indexOf(':');
    if (i <= 0 || typeof value !== 'number') continue;
    const metric = name.slice(0, i);
    const id = name.slice(i + 1);
    into[id] ??= {};
    into[id][metric] = (into[id][metric] ?? 0) + value;
  }
}

/**
 * Tela de operacao (GET /v1/admin/overview).
 *
 * @param {object} input
 *   dayItems:   itens DAY#... da janela (com `key`)
 *   weekItems:  WEEK#... (com `key`), qualquer ordem
 *   monthItems: MONTH#... (com `key`), qualquer ordem
 *   today:      'YYYY-MM-DD' (fuso do painel)
 *   days:       tamanho da janela
 *   labels:     { lessons: { [id]: { title, unitId, unitTitle } }, signs: { [id]: gloss } }
 */
export function buildOverview({ dayItems = [], weekItems = [], monthItems = [], today, days = OVERVIEW_DAYS, labels = {} }) {
  const from = addDays(today, -(days - 1));
  const totalsByDay = new Map();
  const lessons = {};
  const exercises = {};
  const signs = {};
  const errorsByFunction = {};

  for (const item of dayItems) {
    const m = DAY_KEY_RE.exec(item.key ?? '');
    if (!m || m[1] < from || m[1] > today) continue;
    const [, day, part] = m;
    if (!part) totalsByDay.set(day, item);
    else if (part === 'LESSON') unflatten(item, lessons);
    else if (part === 'EXERCISE') unflatten(item, exercises);
    else unflatten(item, signs);
  }

  const series = [];
  let collectedThrough = null;
  for (let i = 0; i < days; i += 1) {
    const day = addDays(from, i);
    const t = totalsByDay.get(day) ?? {};
    const cloud = t.cloud ?? null;
    if (cloud) {
      collectedThrough = day;
      for (const [name, n] of Object.entries(cloud.errorsByFunction ?? {})) add(errorsByFunction, name, num(n));
    }
    series.push({
      day,
      activeUsers: num(t.activeUsers),
      newAccounts: num(t.newAccounts),
      lessonsCompleted: num(t.lessonsCompleted),
      practiceSessions: num(t.practiceSessions),
      lessonAbandons: num(t.lessonAbandons),
      // null = o job diario ainda nao trouxe o CloudWatch desse dia (hoje, ou job atrasado)
      serverErrors: cloud ? num(cloud.api5xx) + num(cloud.lambdaErrors) : null,
      api5xx: cloud ? num(cloud.api5xx) : null,
      lambdaErrors: cloud ? num(cloud.lambdaErrors) : null,
      apiRequests: cloud ? num(cloud.apiRequests) : null,
    });
  }

  const periodRows = (items, prefix, name, count) =>
    items
      .filter((i) => typeof i.key === 'string' && i.key.startsWith(prefix))
      .map((i) => ({
        [name]: i.key.slice(prefix.length),
        activeUsers: num(i.activeUsers),
        newAccounts: num(i.newAccounts),
        lessonsCompleted: num(i.lessonsCompleted),
      }))
      .sort((a, b) => (a[name] < b[name] ? -1 : 1))
      .slice(-count);
  const weeks = periodRows(weekItems, 'WEEK#', 'week', OVERVIEW_WEEKS);
  const months = periodRows(monthItems, 'MONTH#', 'month', OVERVIEW_MONTHS);
  const { week: thisWeek, month: thisMonth } = periodsOf(today);

  const sum = (field) => series.reduce((acc, d) => acc + d[field], 0);
  const lessonRows = Object.entries(lessons)
    .map(([lessonId, c]) => {
      const done = num(c.done);
      const abandon = num(c.abandon);
      const attempted = num(c.attempted);
      const wrong = num(c.wrong);
      const label = labels.lessons?.[lessonId] ?? {};
      return {
        lessonId,
        title: label.title ?? null,
        unitId: label.unitId ?? null,
        unitTitle: label.unitTitle ?? null,
        done,
        abandon,
        abandonRate: ratio(abandon, done + abandon),
        attempted,
        wrong,
        wrongRate: ratio(wrong, attempted),
        failedSigns: num(c.failedSigns),
        reviewedSigns: num(c.reviewedSigns),
      };
    })
    .sort((a, b) => b.abandon + b.wrong - (a.abandon + a.wrong) || (a.lessonId < b.lessonId ? -1 : 1));

  const exerciseRows = Object.entries(exercises)
    .map(([type, c]) => ({
      type,
      attempted: num(c.attempted),
      wrong: num(c.wrong),
      wrongRate: ratio(num(c.wrong), num(c.attempted)),
      abandon: num(c.abandon),
    }))
    .sort((a, b) => b.wrong + b.abandon - (a.wrong + a.abandon) || (a.type < b.type ? -1 : 1));

  const signRows = Object.entries(signs)
    .map(([signId, c]) => ({ signId, gloss: labels.signs?.[signId] ?? null, failed: num(c.failed) }))
    .filter((s) => s.failed > 0)
    .sort((a, b) => b.failed - a.failed || (a.signId < b.signId ? -1 : 1))
    .slice(0, 15);

  return {
    today,
    range: { from, to: today },
    totals: {
      activeToday: series[series.length - 1]?.activeUsers ?? 0,
      activeWeek: weeks.find((w) => w.week === thisWeek)?.activeUsers ?? 0,
      activeMonth: months.find((m) => m.month === thisMonth)?.activeUsers ?? 0,
      newAccounts: sum('newAccounts'),
      lessonsCompleted: sum('lessonsCompleted'),
      lessonAbandons: sum('lessonAbandons'),
      serverErrors: series.reduce((acc, d) => acc + (d.serverErrors ?? 0), 0),
    },
    days: series,
    weeks,
    months,
    lessons: lessonRows,
    exercises: exerciseRows,
    signs: signRows,
    serverErrors: {
      collectedThrough,
      byFunction: Object.entries(errorsByFunction)
        .map(([name, errors]) => ({ name, errors }))
        .sort((a, b) => b.errors - a.errors || (a.name < b.name ? -1 : 1)),
    },
  };
}
