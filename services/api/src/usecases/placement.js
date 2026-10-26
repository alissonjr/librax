import { quietly, recordPlacement } from './opsMetrics.js';

/**
 * Marca do teste de nivelamento (apps/web-poc/src/lib/placement.ts), chegando pela fila de
 * conclusoes (POST /v1/lesson/complete ou POST /v1/guest/migrate com `placement`).
 *
 * - `skip`: a licao foi pulada pelo teste. Grava o progresso com status 'placement' so se a licao
 *   ainda nao tem registro: conclusao de verdade nunca e coberta.
 * - `undo`: o teste foi desfeito. Apaga o registro so se ele ainda e de licao pulada; a licao refeita
 *   depois do teste ja virou conclusao normal (completeLesson substitui a marca) e fica.
 *
 * Nada alem do progresso: sem XP, sem ofensiva, sem SRS, sem conquista (nem "alfabeto completo",
 * que so vem de concluir de verdade a alphabetLessonId), sem liga e sem squads. Idempotente por
 * `lessonAttemptId`, como a conclusao: o reenvio devolve o resultado guardado e nao conta de novo
 * no painel de administracao (`placement:<licao>` e `placementUndo:<licao>`).
 *
 * @param {object} repo
 * @param {{userId: string, lessonAttemptId: string, lessonId: string, today: string,
 *          placement: 'skip'|'undo'}} input
 * @returns {Promise<{placement: string, lessonId: string, changed: boolean, xpAwarded: 0,
 *          lessonAttemptId: string, duplicate: boolean}>}
 */
export async function applyPlacementOnce(repo, input) {
  const { userId, lessonAttemptId, lessonId, today, placement } = input;

  const claimed = await repo.claimLessonAttempt(userId, lessonAttemptId, { lessonId, placement });
  if (!claimed) {
    const previous = await repo.getLessonAttempt(userId, lessonAttemptId);
    return { ...(previous?.result ?? {}), lessonAttemptId, duplicate: true, status: previous?.status ?? 'pending' };
  }

  let changed;
  try {
    changed = placement === 'undo'
      ? await repo.clearPlacementSkip(userId, lessonId)
      : await repo.markPlacementSkip(userId, lessonId, { skippedAt: today });
  } catch (err) {
    await repo.releaseLessonAttempt(userId, lessonAttemptId);
    throw err;
  }
  const result = { placement, lessonId, changed, xpAwarded: 0 };
  await repo.finishLessonAttempt(userId, lessonAttemptId, result);
  if (changed) await quietly('nivelamento', () => recordPlacement(repo, { lessonId, today, placement }));
  return { ...result, lessonAttemptId, duplicate: false };
}
