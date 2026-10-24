import { parseIsoDate, daysBetween } from '../lib/dates.js';

/**
 * Validacao das conclusoes de licao que chegam do cliente (SPEC 02 secao 5.2 e plano
 * mobile web 3.6): POST /v1/lesson/complete e o log do convidado em POST /v1/guest/migrate.
 *
 * O cliente nao e confiavel: so passam campos conhecidos, com tipo e tamanho checados.
 * XP vem do catalogo (completeLesson), signsLearnedDelta e limitado pela licao e
 * alphabetComplete e derivado do catalogo, nunca do cliente.
 */

export const LIMITS = {
  maxBodyBytes: 256 * 1024, // ~200 conclusoes com SRS cabem com folga
  maxEntries: 200, // por envio; o app manda em lotes
  maxReviewed: 100, // sinais revisados por licao
  pastDays: 365, // conclusao mais antiga aceita
  futureDays: 1, // folga de fuso horario
};

export const RESULT_STATES = ['correct', 'accept_soft', 'retry_resolved', 'failed', 'no_capture'];

/** Tipos de exercicio do app (apps/web-poc/src/lib/content.ts, RenderedExerciseType). */
export const EXERCISE_TYPES = [
  'sign_intro',
  'perform_sign',
  'watch_choose_word',
  'word_choose_video',
  'match_pairs',
  'order_sequence',
  'build_phrase',
  'fingerspell',
  'mirror_practice',
];
/** Respostas por tipo de exercicio numa licao (as licoes tem de 8 a 20 exercicios). */
const MAX_ANSWERS_PER_TYPE = 100;
const MAX_EXERCISE_INDEX = 200;

// UUID v4 passa; aceita outros ids opacos do cliente sem espaco nem separador de chave.
export const ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SIGN_ID_MAX = 64;
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/** Data-calendario valida ('YYYY-MM-DD' que existe de fato, sem rolagem de 31/02). */
export function isRealDate(iso) {
  if (typeof iso !== 'string') return false;
  try {
    return new Date(parseIsoDate(iso)).toISOString().slice(0, 10) === iso;
  } catch {
    return false;
  }
}

export function parseReviewed(raw, signs) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > LIMITS.maxReviewed) return null;
  const out = [];
  for (const item of raw) {
    if (!isObject(item) || !isObject(item.result)) return null;
    const { signId } = item;
    if (typeof signId !== 'string' || signId.length > SIGN_ID_MAX || !signs.has(signId)) return null;
    if (!RESULT_STATES.includes(item.result.state)) return null;
    const result = { state: item.result.state };
    if (item.result.highConfidence !== undefined) result.highConfidence = Boolean(item.result.highConfidence);
    out.push({ signId, result });
  }
  return out;
}

/**
 * Respostas e erros por tipo de exercicio (`{ mc4: { attempted, wrong } }`), so para os contadores
 * do painel de administracao (docs/painel-admin.md). E telemetria: formato invalido vira `null`
 * e a conclusao segue valendo, sem perder XP por causa dela.
 */
export function parseExerciseStats(raw) {
  if (!isObject(raw)) return null;
  const out = {};
  for (const [type, value] of Object.entries(raw)) {
    if (!EXERCISE_TYPES.includes(type) || !isObject(value)) return null;
    const { attempted, wrong } = value;
    const count = (n) => Number.isInteger(n) && n >= 0 && n <= MAX_ANSWERS_PER_TYPE;
    if (!count(attempted) || !count(wrong) || wrong > attempted) return null;
    if (attempted > 0) out[type] = { attempted, wrong };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Valida e normaliza uma conclusao.
 *
 * @param {object} raw     conclusao vinda do cliente
 * @param {object} ctx     { catalog, today: 'YYYY-MM-DD' (servidor, UTC), requireAttemptId = true }
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseCompletionEntry(raw, ctx) {
  const { catalog, today, requireAttemptId = true } = ctx;
  if (!isObject(raw)) return { ok: false, error: 'NOT_OBJECT' };

  const { lessonAttemptId = null } = raw;
  if (lessonAttemptId !== null || requireAttemptId) {
    if (typeof lessonAttemptId !== 'string' || !ATTEMPT_ID_RE.test(lessonAttemptId)) {
      return { ok: false, error: 'BAD_ATTEMPT_ID' };
    }
  }

  const lessons = catalog.lessons ?? {};
  const { lessonId } = raw;
  if (typeof lessonId !== 'string' || !has(lessons, lessonId)) return { ok: false, error: 'UNKNOWN_LESSON' };

  if (!isRealDate(raw.today)) return { ok: false, error: 'BAD_DATE' };
  const age = daysBetween(today, raw.today);
  if (age > LIMITS.pastDays || age < -LIMITS.futureDays) return { ok: false, error: 'DATE_OUT_OF_RANGE' };

  const { score } = raw;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) {
    return { ok: false, error: 'BAD_SCORE' };
  }

  const completedAt = raw.completedAt ?? null;
  const badInstant = (v) => typeof v !== 'string' || !ISO_DATETIME_RE.test(v) || Number.isNaN(Date.parse(v));
  if (completedAt !== null && badInstant(completedAt)) {
    return { ok: false, error: 'BAD_COMPLETED_AT' };
  }

  const reviewed = parseReviewed(raw.reviewed, new Set(catalog.signsOrder ?? []));
  if (reviewed === null) return { ok: false, error: 'BAD_REVIEWED' };

  const signCount = lessons[lessonId].signCount ?? 0;
  const delta = Number.isInteger(raw.signsLearnedDelta) ? raw.signsLearnedDelta : 0;
  const exerciseStats = parseExerciseStats(raw.exerciseStats);

  return {
    ok: true,
    value: {
      lessonAttemptId,
      lessonId,
      today: raw.today,
      score,
      completedAt,
      reviewed,
      signsLearnedDelta: Math.min(Math.max(delta, 0), signCount),
      alphabetComplete: lessonId === catalog.alphabetLessonId,
      ...(exerciseStats ? { exerciseStats } : {}),
    },
  };
}

/**
 * Valida a saida de uma licao no meio (POST /v1/lesson/abandon), que alimenta o "onde as pessoas
 * desistem" do painel de administracao. Sem XP, sem SRS: so contadores.
 *
 * @param {object} raw  { lessonId, today, exerciseIndex, exerciseCount, exerciseType? }
 * @param {object} ctx  { catalog, today: 'YYYY-MM-DD' (servidor, UTC) }
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseLessonAbandon(raw, ctx) {
  const { catalog, today } = ctx;
  if (!isObject(raw)) return { ok: false, error: 'NOT_OBJECT' };

  const { lessonId } = raw;
  if (typeof lessonId !== 'string' || !has(catalog.lessons ?? {}, lessonId)) return { ok: false, error: 'UNKNOWN_LESSON' };

  if (!isRealDate(raw.today)) return { ok: false, error: 'BAD_DATE' };
  const age = daysBetween(today, raw.today);
  if (age > LIMITS.pastDays || age < -LIMITS.futureDays) return { ok: false, error: 'DATE_OUT_OF_RANGE' };

  const { exerciseIndex, exerciseCount } = raw;
  const inRange = (n, min) => Number.isInteger(n) && n >= min && n <= MAX_EXERCISE_INDEX;
  if (!inRange(exerciseCount, 1) || !inRange(exerciseIndex, 0) || exerciseIndex > exerciseCount) {
    return { ok: false, error: 'BAD_EXERCISE_INDEX' };
  }

  const exerciseType = raw.exerciseType ?? null;
  if (exerciseType !== null && !EXERCISE_TYPES.includes(exerciseType)) return { ok: false, error: 'BAD_EXERCISE_TYPE' };

  return { ok: true, value: { lessonId, today: raw.today, exerciseIndex, exerciseCount, exerciseType } };
}

/**
 * Valida o log do convidado inteiro. Erro de formato do envio lanca Error(codigo);
 * conclusao invalida vai para `rejected` sem impedir as outras.
 * As validas saem em ordem cronologica (dia, horario, posicao), porque a ofensiva
 * depende da ordem em que os dias sao aplicados.
 *
 * @param {object} payload { entries: object[] }
 * @param {object} ctx     ver parseCompletionEntry
 */
export function parseGuestLog(payload, ctx) {
  if (!isObject(payload) || !Array.isArray(payload.entries)) throw new Error('BAD_PAYLOAD');
  const { entries } = payload;
  if (entries.length === 0) throw new Error('EMPTY_LOG');
  if (entries.length > LIMITS.maxEntries) throw new Error('TOO_MANY_ENTRIES');

  const valid = [];
  const rejected = [];
  entries.forEach((raw, index) => {
    const r = parseCompletionEntry(raw, { ...ctx, requireAttemptId: true });
    if (r.ok) {
      valid.push({ ...r.value, index });
    } else {
      const id = isObject(raw) && typeof raw.lessonAttemptId === 'string' ? raw.lessonAttemptId.slice(0, 64) : null;
      rejected.push({ index, lessonAttemptId: id, reason: r.error });
    }
  });

  valid.sort(
    (a, b) =>
      a.today.localeCompare(b.today) ||
      (Date.parse(a.completedAt) || 0) - (Date.parse(b.completedAt) || 0) ||
      a.index - b.index,
  );
  return { valid: valid.map(({ index, ...rest }) => rest), rejected };
}
