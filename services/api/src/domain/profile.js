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
