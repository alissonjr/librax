/**
 * XP de uma licao concluida (SPEC 02 secao 5.2).
 * O servidor calcula a partir da DEFINICAO da licao; nunca confia em XP do cliente.
 *
 * @param {{xpReward?: number}} lesson
 * @returns {number}
 */
export function xpForLesson(lesson) {
  return lesson?.xpReward ?? 10;
}

/**
 * Indica se ESTA conclusao cruzou a meta diaria (para emitir `goal_met` uma unica vez).
 *
 * @param {number} xpBefore  XP do dia antes desta conclusao
 * @param {number} xpGained  XP ganho agora
 * @param {number} goal      meta diaria em XP (ex.: 10/20/50)
 * @returns {boolean}
 */
export function isDailyGoalMet(xpBefore, xpGained, goal) {
  if (goal <= 0) return false;
  return xpBefore < goal && xpBefore + xpGained >= goal;
}
