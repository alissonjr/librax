import { daysBetween } from '../lib/dates.js';
import { LIMITS, ATTEMPT_ID_RE, isRealDate, parseReviewed } from './lessonCompletion.js';

/**
 * Validacao das respostas da pratica diaria que chegam do cliente (POST /v1/practice/review,
 * SPEC 03 secao 11.12). Mesmas regras de sinal, estado e data das conclusoes de licao
 * (lessonCompletion.js), sem licao, score nem XP: a pratica so mexe no SRS.
 *
 * `reviewAttemptId` e obrigatorio por padrao: o SM-2 nao e idempotente (cada acerto aumenta o
 * intervalo), entao o reenvio da mesma resposta precisa ser reconhecido.
 *
 * @param {object} raw  { reviewAttemptId, today, reviewed[] }
 * @param {object} ctx  { catalog, today: 'YYYY-MM-DD' (servidor, UTC), requireAttemptId = true }
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parsePracticeReview(raw, ctx) {
  const { catalog, today, requireAttemptId = true } = ctx;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'NOT_OBJECT' };

  const { reviewAttemptId = null } = raw;
  if (reviewAttemptId !== null || requireAttemptId) {
    if (typeof reviewAttemptId !== 'string' || !ATTEMPT_ID_RE.test(reviewAttemptId)) {
      return { ok: false, error: 'BAD_ATTEMPT_ID' };
    }
  }

  if (!isRealDate(raw.today)) return { ok: false, error: 'BAD_DATE' };
  const age = daysBetween(today, raw.today);
  if (age > LIMITS.pastDays || age < -LIMITS.futureDays) return { ok: false, error: 'DATE_OUT_OF_RANGE' };

  if (!Array.isArray(raw.reviewed) || raw.reviewed.length === 0) return { ok: false, error: 'BAD_REVIEWED' };
  const reviewed = parseReviewed(raw.reviewed, new Set(catalog.signsOrder ?? []));
  if (reviewed === null) return { ok: false, error: 'BAD_REVIEWED' };

  return { ok: true, value: { reviewAttemptId, today: raw.today, reviewed } };
}
