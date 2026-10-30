/**
 * Perfil default de um usuario (SPEC 02 secao 3 - item PROFILE).
 * `signsLearned`/`lessonsCompleted`/`alphabetComplete` alimentam as conquistas.
 *
 * @param {string} userId
 * @param {Partial<object>} [overrides]
 */
export function newProfile(userId, overrides = {}) {
  return {
    userId,
    displayName: null,
    locale: 'pt-BR',
    timezone: 'America/Sao_Paulo',
    xpTotal: 0,
    streak: 0,
    lastActiveDay: null,
    freezes: 0,
    dailyGoalXp: 20,
    signsLearned: 0,
    lessonsCompleted: 0,
    alphabetComplete: false,
    ...overrides,
  };
}

/** Nome de quem estuda (escolhido no onboarding): de 1 a 30 caracteres depois da limpeza. */
export const DISPLAY_NAME_MAX = 30;

/**
 * Nome como aparece nos rankings: tira caracteres de controle, os invisiveis e os que invertem a
 * direcao do texto, junta espacos repetidos e apara as pontas. Conta caracteres, nao unidades
 * UTF-16 (acento e emoji valem um).
 * @returns {string|null} o nome limpo ou null se nao for texto ou ficar fora de 1 a 30
 */
export function cleanDisplayName(value) {
  if (typeof value !== 'string') return null;
  const clean = value
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const length = [...clean].length;
  return length >= 1 && length <= DISPLAY_NAME_MAX ? clean : null;
}

/**
 * Corpo do PUT /v1/users/me/profile: `{ displayName?, showInGlobalRanking? }`, pelo menos um.
 * Campo a mais e ignorado.
 * @returns {{ok: true, changes: {displayName?: string, showInGlobalRanking?: boolean}} | {ok: false, error: string}}
 */
export function parseProfileUpdate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'NO_CHANGES' };
  const changes = {};
  if (input.displayName !== undefined) {
    const name = cleanDisplayName(input.displayName);
    if (name === null) return { ok: false, error: 'INVALID_NAME' };
    changes.displayName = name;
  }
  if (input.showInGlobalRanking !== undefined) {
    if (typeof input.showInGlobalRanking !== 'boolean') return { ok: false, error: 'INVALID_RANKING_CHOICE' };
    changes.showInGlobalRanking = input.showInGlobalRanking;
  }
  if (Object.keys(changes).length === 0) return { ok: false, error: 'NO_CHANGES' };
  if (input.keepExistingName !== undefined && typeof input.keepExistingName !== 'boolean') {
    return { ok: false, error: 'INVALID_KEEP_NAME' };
  }
  return { ok: true, changes, ...(input.keepExistingName === true ? { keepExistingName: true } : {}) };
}
