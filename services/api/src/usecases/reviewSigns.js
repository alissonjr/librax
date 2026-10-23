import { updateSrs, qualityFromResult, newSrsItem } from '../domain/srs.js';

/**
 * Grava no SRS o resultado de sinais revisados (SPEC 03 secao 6): a pratica diaria chama a cada
 * resposta (SPEC 03 secao 11.12) e o completeLesson ao concluir a licao.
 *
 * So mexe no SRS. XP e ofensiva ficam com o completeLesson: a SPEC 02 (secao 5) liga os dois a
 * conclusao de licao e a SPEC 03 nao da XP nem ofensiva para a pratica.
 *
 * @param {object} repo   porta de repositorio (ver InMemoryRepo)
 * @param {object} input  { userId, today: 'YYYY-MM-DD' (fuso do usuario), reviewed: [{ signId, result }] }
 * @returns {Promise<{srsUpdated: number, items: object[]}>} itens gravados (ef, reps, interval, dueAt)
 */
export async function reviewSigns(repo, input) {
  const { userId, today, reviewed = [] } = input;
  const items = [];

  for (const { signId, result } of reviewed) {
    const q = qualityFromResult(result);
    if (q === null) continue; // no_capture: nao e sinal de aprendizado
    const current = (await repo.getSrsItem(userId, signId)) ?? newSrsItem();
    const next = updateSrs(current, q, today);
    await repo.saveSrsItem(userId, signId, next);
    items.push({ signId, ...next });
  }

  return { srsUpdated: items.length, items };
}

/**
 * reviewSigns idempotente por `reviewAttemptId` (POST /v1/practice/review). O SM-2 nao e
 * idempotente: aplicar o mesmo acerto duas vezes alongaria o intervalo de novo. Usa a mesma
 * reserva das conclusoes de licao (`ATTEMPT#<id>`, ver completeLessonOnce); quem nao consegue
 * reservar recebe o resultado ja guardado.
 *
 * @param {object} repo
 * @param {object} input  entrada do reviewSigns + reviewAttemptId
 */
export async function reviewSignsOnce(repo, input) {
  const { userId, reviewAttemptId } = input;

  const claimed = await repo.claimLessonAttempt(userId, reviewAttemptId, { kind: 'practice' });
  if (!claimed) {
    const previous = await repo.getLessonAttempt(userId, reviewAttemptId);
    return { ...(previous?.result ?? {}), reviewAttemptId, duplicate: true, status: previous?.status ?? 'pending' };
  }

  let result;
  try {
    result = await reviewSigns(repo, input);
  } catch (err) {
    await repo.releaseLessonAttempt(userId, reviewAttemptId);
    throw err;
  }
  await repo.finishLessonAttempt(userId, reviewAttemptId, result);
  return { ...result, reviewAttemptId, duplicate: false };
}
