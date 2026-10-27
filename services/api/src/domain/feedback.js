import { isTelemetryId, parseSnapshot, telKey } from './telemetry.js';
import { DAY_RETENTION_DAYS, WEEK_RETENTION_DAYS, opsExpiry, periodsOf } from './opsMetrics.js';

// Nota de 1 a 5 e comentario opcional do app (POST /v1/feedback, docs/painel-admin.md).
//
//   TEL#<id> / FEEDBACK          a nota do codigo anonimo (uma por codigo: a nova substitui a velha),
//                                com o comentario, o retrato e o dia. TTL de 12 meses
//   FBLIST / <ISO>#<aleatorio>   copia para a lista do painel, da mais nova para a mais velha
//   FBLIST#R<n> / <ISO>#...      a mesma copia, por nota (filtro do painel), sem Scan nem indice novo
//   TELAGG / DAY#<dia>, WEEK#<semana>, FEEDBACK
//                                fb_n, fb_sum e fb_r1..fb_r5 (ADD), para media, distribuicao e tendencia
//
// O codigo e o mesmo dos dados de uso; com os dados de uso desligados, o app manda um codigo
// aleatorio so para a nota. Apagar o codigo (DELETE /v1/telemetry/{id}) apaga a nota e as copias da
// lista e desconta os totais.

export const FEEDBACK_TEXT_MAX = 1000;
export const FEEDBACK_MAX_BODY_BYTES = 8 * 1024;
export const FEEDBACK_TTL_DAYS = 365;
export const FEEDBACK_LIST_PK = 'FBLIST';
export const feedbackListPk = (rating) => (rating == null ? FEEDBACK_LIST_PK : `${FEEDBACK_LIST_PK}#R${rating}`);

const DAY_S = 24 * 60 * 60;

/**
 * Comentario como texto simples: tira caracteres de controle (menos a quebra de linha), os
 * invisiveis e os que invertem a direcao do texto, junta quebras repetidas e apara as pontas.
 */
export function cleanFeedbackText(raw) {
  return String(raw)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ ]{2,}/g, ' ')
    .trim();
}

/**
 * Corpo do app: `{ id, rating, text?, snapshot }`. Nota inteira de 1 a 5; comentario de ate 1000
 * caracteres depois da limpeza; o retrato e o mesmo dos dados de uso (domain/telemetry.js).
 */
export function parseFeedback(raw, { catalog }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'BAD_FEEDBACK' };
  if (!isTelemetryId(raw.id)) return { ok: false, error: 'BAD_ID' };
  if (!Number.isInteger(raw.rating) || raw.rating < 1 || raw.rating > 5) return { ok: false, error: 'BAD_RATING' };
  if (raw.text != null && typeof raw.text !== 'string') return { ok: false, error: 'BAD_TEXT' };
  const text = cleanFeedbackText(raw.text ?? '');
  if (text.length > FEEDBACK_TEXT_MAX) return { ok: false, error: 'TEXT_TOO_LONG' };
  const snapshot = parseSnapshot(raw.snapshot, catalog);
  if (!snapshot.ok) return snapshot;
  const s = snapshot.value;
  return {
    ok: true,
    value: {
      id: raw.id,
      rating: raw.rating,
      text,
      // so o que a lista do painel mostra; XP e sequencia nao vao junto com a nota
      context: {
        lessonsCompleted: s.lessonsCompleted,
        currentLessonId: s.currentLessonId,
        hasAccount: s.hasAccount,
        appVersion: s.appVersion,
        lang: s.lang,
        platform: s.platform,
        installed: s.installed,
      },
    },
  };
}

/** Contadores de uma nota (`sign` -1 desconta a nota substituida ou apagada). */
export function feedbackCounters(rating, sign = 1) {
  return { fb_n: sign, fb_sum: sign * rating, [`fb_r${rating}`]: sign };
}

/** Somas de uma nota no dia, na semana e no total. */
export function feedbackWrites({ rating, day, sign = 1 }) {
  const counters = feedbackCounters(rating, sign);
  const { week } = periodsOf(day);
  return [
    { key: telKey.day(day), counters, expiresAt: opsExpiry(day, DAY_RETENTION_DAYS) },
    { key: telKey.week(week), counters, expiresAt: opsExpiry(day, WEEK_RETENTION_DAYS) },
    { key: telKey.feedback, counters, expiresAt: null },
  ];
}

/** Item da nota e a entrada da lista (o mesmo conteudo, sem o codigo anonimo na lista). */
export function feedbackItem({ value, now, day, entryId }) {
  const at = now.toISOString();
  const expiresAt = Math.floor(now.getTime() / 1000) + FEEDBACK_TTL_DAYS * DAY_S;
  const listSk = `${at}#${entryId}`;
  const entry = { at, day, rating: value.rating, text: value.text, ...value.context };
  return { item: { ...entry, listSk, expiresAt }, entry, listSk, expiresAt };
}
