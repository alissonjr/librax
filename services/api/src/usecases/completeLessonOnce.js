import { completeLesson } from './completeLesson.js';
import { quietly, recordLessonCompleted } from './opsMetrics.js';

/**
 * completeLesson idempotente por `lessonAttemptId` (plano mobile web, fase W3).
 *
 * O app guarda cada conclusao numa fila offline e reenvia ate ter resposta; a mesma
 * tentativa pode chegar duas vezes (rede caiu depois do servidor gravar, aba duplicada,
 * migracao do convidado repetida). Antes de aplicar, reserva a tentativa com escrita
 * condicional (`USER#<id> / ATTEMPT#<lessonAttemptId>`); quem nao consegue reservar
 * recebe o resultado ja guardado e nada e somado de novo (XP, ofensiva, SRS, liga, squads).
 *
 * Se o completeLesson falhar, a reserva e liberada para o reenvio poder aplicar.
 *
 * Conclusao aplicada soma nos contadores do painel de administracao (opsMetrics.js); reenvio nao.
 *
 * @param {object} repo     porta de repositorio (ver InMemoryRepo)
 * @param {object} content  catalogo ({ lessons, achievementRules, ... })
 * @param {object} input    entrada do completeLesson + lessonAttemptId
 * @returns {Promise<object>} resultado do completeLesson + { lessonAttemptId, duplicate }
 */
export async function completeLessonOnce(repo, content, input) {
  const { userId, lessonAttemptId, lessonId } = input;

  const claimed = await repo.claimLessonAttempt(userId, lessonAttemptId, { lessonId });
  if (!claimed) {
    const previous = await repo.getLessonAttempt(userId, lessonAttemptId);
    return { ...(previous?.result ?? {}), lessonAttemptId, duplicate: true, status: previous?.status ?? 'pending' };
  }

  let result;
  try {
    result = await completeLesson(repo, content, input);
  } catch (err) {
    await repo.releaseLessonAttempt(userId, lessonAttemptId);
    throw err;
  }
  await repo.finishLessonAttempt(userId, lessonAttemptId, result);
  await quietly('licao', () => recordLessonCompleted(repo, input));
  return { ...result, lessonAttemptId, duplicate: false };
}
