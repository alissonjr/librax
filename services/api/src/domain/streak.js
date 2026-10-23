import { daysBetween } from '../lib/dates.js';

/**
 * @typedef {Object} StreakState
 * @property {number} streak         sequencia atual (dias)
 * @property {string|null} lastActiveDay  ultimo dia estudado ('YYYY-MM-DD') no fuso do usuario
 * @property {number} freezes        streak freezes disponiveis
 */

/**
 * Aplica a regra de ofensiva ao concluir uma licao (SPEC 02 secao 5.1).
 *
 * - mesmo dia            -> no-op
 * - dia consecutivo      -> streak + 1
 * - 1 dia perdido c/ freeze -> consome 1 freeze e mantem a sequencia (streak + 1)
 * - qualquer outro gap   -> streak = 1
 *
 * Pura: nao muta `state`. `today` ja vem no fuso do usuario.
 *
 * @param {StreakState} state
 * @param {string} today 'YYYY-MM-DD'
 */
export function applyStreak(state, today) {
  const streak = state.streak ?? 0;
  const freezes = state.freezes ?? 0;
  const last = state.lastActiveDay ?? null;

  const base = {
    streak,
    lastActiveDay: today,
    freezes,
    dayLogged: true,
    changed: true,
    freezeConsumed: false,
  };

  if (last === null) {
    return { ...base, streak: 1 };
  }

  const gap = daysBetween(today, last);

  if (gap <= 0) {
    // mesmo dia (ou data anterior/empate): nada a fazer
    return {
      streak,
      lastActiveDay: last,
      freezes,
      dayLogged: false,
      changed: false,
      freezeConsumed: false,
    };
  }

  if (gap === 1) {
    return { ...base, streak: streak + 1 };
  }

  // gap === 2 = exatamente um dia perdido: freeze perdoa
  if (gap === 2 && freezes > 0) {
    return { ...base, streak: streak + 1, freezes: freezes - 1, freezeConsumed: true };
  }

  return { ...base, streak: 1 };
}
