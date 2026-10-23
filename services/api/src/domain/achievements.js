// Conquistas declarativas (SPEC 02 secao 5.4).
// Cada regra: { code, type, gte? }. Avaliadas apos cada evento relevante; idempotente.

const FIELD_BY_TYPE = {
  streak: 'streak',
  signs_learned: 'signsLearned',
  lessons_completed: 'lessonsCompleted',
  alphabet_complete: 'alphabetComplete',
};

const BOOLEAN_TYPES = new Set(['alphabet_complete']);

/**
 * Retorna os codigos de conquista recem-conquistados (ainda nao ganhos) cujo
 * criterio o estado atual satisfaz.
 *
 * @param {Array<{code: string, type: string, gte?: number}>} rules
 * @param {Record<string, number|boolean>} state  fatos do usuario (streak, signsLearned, ...)
 * @param {Iterable<string>} [earned]  codigos ja conquistados
 * @returns {string[]}
 */
export function evaluateAchievements(rules, state, earned = []) {
  const earnedSet = earned instanceof Set ? earned : new Set(earned);
  const out = [];
  for (const rule of rules) {
    if (earnedSet.has(rule.code)) continue;
    if (meetsRule(rule, state)) out.push(rule.code);
  }
  return out;
}

function meetsRule(rule, state) {
  const field = FIELD_BY_TYPE[rule.type];
  if (!field) throw new Error(`tipo de conquista desconhecido: ${rule.type}`);
  const value = state[field];
  if (BOOLEAN_TYPES.has(rule.type)) return value === true;
  return typeof value === 'number' && value >= rule.gte;
}
