/**
 * Handlers Lambda para endpoints de licao e fila diaria.
 *
 * POST /v1/lesson/complete  -> completeLesson (idempotente com lessonAttemptId)
 * GET  /v1/lesson/queue     -> getDailyQueue
 * POST /v1/lesson/abandon   -> recordLessonAbandon (saida no meio da licao; so contadores do
 *                              painel de administracao, sem XP nem SRS)
 *
 * Mapeamento API Gateway HTTP API (payload format 2.0):
 *   event.routeKey = "POST /v1/lesson/complete"
 *   event.requestContext.authorizer.jwt.claims.sub = userId do Cognito
 *
 * `makeLessonHandlers({ repo, catalog })` recebe as dependencias (testes usam InMemoryRepo);
 * os exports nomeados sao as instancias de producao (DynamoRepo + catalogo empacotado).
 */

import { completeLesson } from '../usecases/completeLesson.js';
import { completeLessonOnce } from '../usecases/completeLessonOnce.js';
import { getDailyQueue } from '../usecases/getDailyQueue.js';
import { parseCompletionEntry, parseLessonAbandon } from '../domain/lessonCompletion.js';
import { quietly, recordLessonAbandon, recordLessonCompleted } from '../usecases/opsMetrics.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { courseCatalog } from './_catalog.js';

const utcDay = (d) => d.toISOString().slice(0, 10);

export function makeLessonHandlers({ repo, catalog, now = () => new Date() }) {
  /** POST /v1/lesson/complete */
  const completeLessonHandler = wrap(async (event) => {
    const uid = userId(event);
    const raw = body(event);
    const today = utcDay(now());
    // cliente antigo podia omitir `today`: usa o dia UTC do servidor
    const parsed = parseCompletionEntry(
      { today, ...raw },
      { catalog, today, requireAttemptId: false },
    );
    if (!parsed.ok) throw new ApiError(400, parsed.error, `Conclusao invalida: ${parsed.error}`);

    // `now` (relogio do servidor) decide a semana da liga e das squads, nunca o aparelho
    const input = { ...parsed.value, userId: uid, now: now().getTime() };
    if (input.lessonAttemptId) return ok(await completeLessonOnce(repo, catalog, input));

    // cliente antigo, sem id da tentativa: aplica direto (completeLessonOnce conta sozinho)
    const result = await completeLesson(repo, catalog, input);
    await quietly('licao', () => recordLessonCompleted(repo, input));
    return ok(result);
  });

  /** POST /v1/lesson/abandon */
  const abandonLessonHandler = wrap(async (event) => {
    const uid = userId(event);
    const parsed = parseLessonAbandon(body(event), { catalog, today: utcDay(now()) });
    if (!parsed.ok) throw new ApiError(400, parsed.error, `Saida invalida: ${parsed.error}`);
    await recordLessonAbandon(repo, { ...parsed.value, userId: uid });
    return ok({ recorded: true });
  });

  /** GET /v1/lesson/queue */
  const getDailyQueueHandler = wrap(async (event) => {
    const uid = userId(event);
    const today = event.queryStringParameters?.today ?? utcDay(now());

    const queue = await getDailyQueue(repo, catalog, { userId: uid, today });
    return ok({ queue });
  });

  return { completeLessonHandler, getDailyQueueHandler, abandonLessonHandler };
}

export const { completeLessonHandler, getDailyQueueHandler, abandonLessonHandler } = makeLessonHandlers({
  repo: dynamoRepo,
  catalog: courseCatalog,
});
