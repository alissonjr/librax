import { parseGuestLog } from '../domain/lessonCompletion.js';
import { completeLessonOnce } from './completeLessonOnce.js';

/**
 * POST /v1/guest/migrate (SPEC 02 secoes 2 e 12.2; plano mobile web 3.6).
 *
 * O convidado joga 100% local. Ao criar conta (ou entrar numa conta existente), o app manda
 * o log de conclusoes guardado na fila offline e o servidor reexecuta cada uma, em ordem
 * cronologica, com o mesmo completeLesson. Assim XP, ofensiva, SRS e conquistas saem das
 * mesmas regras server-authoritative e nao de um "estado final" mandado pelo cliente.
 *
 * Idempotente por lessonAttemptId: reenviar o log inteiro nao soma nada de novo.
 *
 * @param {object} repo
 * @param {object} content catalogo
 * @param {{userId: string, payload: object, now: Date}} input
 * @returns {Promise<{results: object[], summary: object, profile: object}>}
 */
export async function migrateGuest(repo, content, input) {
  const { userId, payload, now } = input;
  const today = now.toISOString().slice(0, 10);
  const { valid, rejected } = parseGuestLog(payload, { catalog: content, today });

  const results = [];
  for (const entry of valid) {
    const r = await completeLessonOnce(repo, content, { ...entry, userId, now: now.getTime() });
    results.push(
      r.duplicate
        ? { lessonAttemptId: entry.lessonAttemptId, status: 'duplicate' }
        : { lessonAttemptId: entry.lessonAttemptId, status: 'applied', xpAwarded: r.xpAwarded },
    );
  }
  for (const r of rejected) {
    results.push({ lessonAttemptId: r.lessonAttemptId, status: 'rejected', reason: r.reason });
  }

  const count = (status) => results.filter((r) => r.status === status).length;
  const profile = await repo.getProfile(userId);

  return {
    results,
    summary: { applied: count('applied'), duplicate: count('duplicate'), rejected: count('rejected') },
    profile: { xpTotal: profile?.xpTotal ?? 0, streak: profile?.streak ?? 0 },
  };
}
