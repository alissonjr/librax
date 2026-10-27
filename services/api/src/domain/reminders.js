/**
 * Regras de lembrete (SPEC 05 secoes 12.2 e 12.3; plano mobile web, decisao 11).
 *
 * Puras: recebem `now` e o fuso IANA do usuario; o horario local nunca vem do relogio do
 * servidor. A Lambda de lembrete roda de hora em hora e chama decideReminder para cada
 * candidato; o estado devolvido em `nextState` e gravado no item `USER#<id> / NOTIF`.
 *
 * Regras da 12.3:
 * - nunca entre 22h e 7h no fuso do usuario;
 * - se abriu o app nas ultimas 3h, nao manda o lembrete diario;
 * - no maximo 2 por dia, exceto a emergencia de ofensiva (streak em risco);
 * - 7 dias seguidos sem interagir com nenhuma notificacao: pausa tudo por 3 dias e depois
 *   volta so o lembrete diario.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const QUIET_START_HOUR = 22;
export const QUIET_END_HOUR = 7;
export const RECENT_OPEN_MS = 3 * HOUR_MS;
export const MAX_PER_DAY = 2;
export const IGNORED_PAUSE_AFTER_MS = 7 * DAY_MS;
export const PAUSE_MS = 3 * DAY_MS;
export const STREAK_RISK_HOUR = 20;
export const STREAK_RISK_MIN = 3;
export const DEFAULT_REMINDER_HOUR = 19;
export const REMINDER_URL = '/?origem=lembrete';

const formatters = new Map();
function formatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function parts(now, timeZone) {
  const out = {};
  for (const p of formatter(timeZone).formatToParts(now)) out[p.type] = p.value;
  return out;
}

/** Fuso IANA reconhecido pelo runtime (ex.: 'America/Sao_Paulo'). */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Dia ('YYYY-MM-DD') e hora (0-23) no fuso do usuario. */
export function localClock(now, timeZone) {
  const p = parts(now, timeZone);
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** Deslocamento do fuso em relacao a UTC, em minutos, no instante `now`. */
export function utcOffsetMinutes(now, timeZone) {
  const p = parts(now, timeZone);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const truncated = Math.floor(now.getTime() / 1000) * 1000;
  return Math.round((asUtc - truncated) / 60000);
}

/**
 * Balde do indice de lembretes (GSI6 `NOTIF#H<balde>`): deslocamento inteiro de UTC,
 * arredondado para baixo (+5:30 cai em 5). Recalculado a cada gravacao do estado, entao
 * acompanha horario de verao com no maximo um dia de atraso.
 */
export function offsetBucket(now, timeZone) {
  return Math.floor(utcOffsetMinutes(now, timeZone) / 60);
}

/**
 * Baldes que valem a consulta nesta hora: os que estao fora do silencio agora, com 1h de
 * folga para fusos de meia hora e para a troca de horario de verao. A decisao final e
 * sempre de decideReminder, com o fuso exato.
 */
export function candidateBuckets(now) {
  const h = now.getUTCHours();
  const out = [];
  for (let b = -12; b <= 14; b += 1) {
    const local = (((h + b) % 24) + 24) % 24;
    if (local >= QUIET_END_HOUR - 1 && local <= QUIET_START_HOUR) out.push(b);
  }
  return out;
}

/**
 * Copy da SPEC 05 12.2 (corpo com no maximo 60 caracteres), no idioma da pessoa (pt-BR, en, es).
 * O mesmo texto vai no push e no e-mail de lembrete.
 */
const REMINDER_COPY = {
  'pt-BR': {
    days: (n) => `${n} ${n === 1 ? 'dia' : 'dias'}`,
    riskTitle: 'Sua sequência vai até meia-noite',
    riskBody: (d) => `${d} não se perdem hoje. Você chega em 5 min.`,
    dailyTitle: 'Libras te espera',
    dailyStreak: (d) => `São só 5 minutinhos. Sua sequência de ${d} agradece.`,
    dailyNoStreak: 'São só 5 minutinhos. Seus sinais te esperam.',
  },
  en: {
    days: (n) => `${n} ${n === 1 ? 'day' : 'days'}`,
    riskTitle: 'Your streak ends at midnight',
    riskBody: (d) => `Do not lose ${d} today. It takes 5 min.`,
    dailyTitle: 'Libras is waiting for you',
    dailyStreak: (d) => `Just 5 minutes. Your streak of ${d} thanks you.`,
    dailyNoStreak: 'Just 5 minutes. Your signs are waiting.',
  },
  es: {
    days: (n) => `${n} ${n === 1 ? 'día' : 'días'}`,
    riskTitle: 'Tu racha dura hasta medianoche',
    riskBody: (d) => `No pierdas tus ${d} hoy. Te toma 5 min.`,
    dailyTitle: 'Libras te espera',
    dailyStreak: (d) => `Solo 5 minutos. Tu racha de ${d} te lo agradece.`,
    dailyNoStreak: 'Solo 5 minutos. Tus señas te esperan.',
  },
};

export function reminderMessage(kind, streak = 0, lang = 'pt-BR') {
  const c = REMINDER_COPY[lang] ?? REMINDER_COPY['pt-BR'];
  if (kind === 'streak_risk') {
    return { title: c.riskTitle, body: c.riskBody(c.days(streak)) };
  }
  return {
    title: c.dailyTitle,
    body: streak > 0 ? c.dailyStreak(c.days(streak)) : c.dailyNoStreak,
  };
}

const EMPTY_STATE = {
  day: null,
  sentCount: 0,
  dailyDay: null,
  streakRiskDay: null,
  lastSentAt: null,
  lastSeenAt: null,
  lastInteractionAt: null,
  ignoredSince: null,
  pausedUntil: null,
  dailyOnly: false,
};

const iso = (d) => d.toISOString();
const ms = (v) => (v ? Date.parse(v) : Number.NaN);

/** O usuario abriu o app (ou o app renovou a inscricao de push). */
export function recordSeen(state, now) {
  return { ...state, lastSeenAt: iso(now) };
}

/** O usuario tocou numa notificacao: zera a contagem de ignoradas e qualquer pausa. */
export function recordInteraction(state, now) {
  return { ...state, lastSeenAt: iso(now), lastInteractionAt: iso(now), ignoredSince: null, pausedUntil: null, dailyOnly: false };
}

/**
 * Decide se manda um lembrete agora.
 *
 * @param {object} args
 * @param {Date}   args.now
 * @param {{reminderHour: number|null, timezone: string}} args.prefs
 * @param {{streak?: number, lastActiveDay?: string|null}} args.profile
 * @param {object} args.state  estado gravado em NOTIF (campos de EMPTY_STATE)
 * @returns {{send: false, reason: string, nextState?: object} |
 *           {send: true, kind: 'daily'|'streak_risk', message: object, nextState: object}}
 */
export function decideReminder({ now, prefs, profile, state }) {
  const { day, hour } = localClock(now, prefs.timezone);
  if (hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR) return { send: false, reason: 'QUIET_HOURS' };
  if (profile.lastActiveDay === day) return { send: false, reason: 'ALREADY_STUDIED' };

  const st = { ...EMPTY_STATE, ...state };
  const t = now.getTime();

  if (ms(st.pausedUntil) > t) return { send: false, reason: 'PAUSED' };
  if (st.pausedUntil) st.pausedUntil = null; // pausa acabou; dailyOnly continua

  if (st.ignoredSince && t - ms(st.ignoredSince) >= IGNORED_PAUSE_AFTER_MS) {
    const nextState = { ...st, ignoredSince: null, pausedUntil: iso(new Date(t + PAUSE_MS)), dailyOnly: true };
    return { send: false, reason: 'PAUSED', nextState };
  }

  const streak = profile.streak ?? 0;
  let kind = null;
  if (!st.dailyOnly && hour === STREAK_RISK_HOUR && streak >= STREAK_RISK_MIN && st.streakRiskDay !== day) {
    kind = 'streak_risk';
  } else if (prefs.reminderHour === hour && st.dailyDay !== day) {
    kind = 'daily';
  }
  if (!kind) return { send: false, reason: 'NOT_DUE' };

  const sentToday = st.day === day ? st.sentCount : 0;
  if (kind === 'daily') {
    if (t - ms(st.lastSeenAt) < RECENT_OPEN_MS) return { send: false, reason: 'RECENTLY_ACTIVE' };
    if (sentToday >= MAX_PER_DAY) return { send: false, reason: 'DAILY_CAP' };
  }

  const nextState = {
    ...st,
    day,
    sentCount: sentToday + 1,
    lastSentAt: iso(now),
    ignoredSince: st.ignoredSince ?? iso(now),
    ...(kind === 'daily' ? { dailyDay: day } : { streakRiskDay: day }),
  };
  return { send: true, kind, message: reminderMessage(kind, streak), nextState };
}
