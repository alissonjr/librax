/**
 * Handlers Lambda para endpoints de licao e fila diaria.
 *
 * POST /v1/lesson/complete  -> completeLesson (idempotente com lessonAttemptId)
 * GET  /v1/lesson/queue     -> getDailyQueue
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
import { parseCompletionEntry } from '../domain/lessonCompletion.js';
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
    const result = input.lessonAttemptId
      ? await completeLessonOnce(repo, catalog, input)
      : await completeLesson(repo, catalog, input);
    return ok(result);
  });

  /** GET /v1/lesson/queue */
  const getDailyQueueHandler = wrap(async (event) => {
    const uid = userId(event);
    const today = event.queryStringParameters?.today ?? utcDay(now());

    const queue = await getDailyQueue(repo, catalog, { userId: uid, today });
    return ok({ queue });
  });

  return { completeLessonHandler, getDailyQueueHandler };
}

export const { completeLessonHandler, getDailyQueueHandler } = makeLessonHandlers({
  repo: dynamoRepo,
  catalog: courseCatalog,
});
