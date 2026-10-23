// Codigo de convite de squad (SPEC 04 secao 2).
// 6 chars, maiusculo, case-insensitive. Alfabeto sem caracteres ambiguos
// (sem O/0, I/1, etc.) para facilitar a digitacao no campo OTP (frontend 4.4).

export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 6;

/**
 * Gera um codigo de convite. A fonte de aleatoriedade e injetada para ser
 * deterministica em teste (e auditavel). Em producao, passar um RNG seguro.
 *
 * @param {() => number} rng  funcao que retorna [0, 1)
 * @returns {string}
 */
export function generateInviteCode(rng) {
  let code = '';
  for (let i = 0; i < INVITE_LENGTH; i++) {
    const idx = Math.floor(rng() * INVITE_ALPHABET.length);
    code += INVITE_ALPHABET[idx];
  }
  return code;
}

/** Normaliza um codigo digitado: remove espacos e força maiusculas. */
export function normalizeInviteCode(input) {
  return (input ?? '').trim().toUpperCase();
}

/** Valida um codigo (apos normalizar): exatamente INVITE_LENGTH chars do alfabeto. */
export function isValidInviteCode(input) {
  const code = normalizeInviteCode(input);
  if (code.length !== INVITE_LENGTH) return false;
  for (const ch of code) {
    if (!INVITE_ALPHABET.includes(ch)) return false;
  }
  return true;
}
