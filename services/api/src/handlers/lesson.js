/**
 * Handlers Lambda para endpoints de licao e fila diaria.
 *
 * POST /v1/lesson/complete  -> completeLesson
 * GET  /v1/lesson/queue     -> getDailyQueue
 *
 * Mapeamento API Gateway HTTP API (payload format 2.0):
 *   event.routeKey = "POST /v1/lesson/complete"
 *   event.requestContext.authorizer.jwt.claims.sub = userId do Cognito
 */

import { completeLesson } from '../usecases/completeLesson.js';
import { getDailyQueue } from '../usecases/getDailyQueue.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo } from './_repo.js';

const COURSE_CATALOG = JSON.parse(process.env.COURSE_CATALOG_JSON ?? '{}');

function courseConfig() {
  if (!COURSE_CATALOG.lessonsMap) {
    throw new ApiError(503, 'CATALOG_UNAVAILABLE', 'Conteudo do curso indisponivel');
  }
  return COURSE_CATALOG;
}

/** POST /v1/lesson/complete */
export const completeLessonHandler = wrap(async (event) => {
  const uid = userId(event);
  const {
    lessonId,
    today,
    score,
    reviewed = [],
    signsLearnedDelta = 0,
    alphabetComplete = false,
  } = body(event);

  if (!lessonId) throw new ApiError(400, 'MISSING_LESSON_ID', 'lessonId obrigatorio');
  if (typeof score !== 'number' || score < 0 || score > 1)
    throw new ApiError(400, 'BAD_SCORE', 'score deve ser numero entre 0 e 1');

  const result = await completeLesson(
    repo,
    courseConfig(),
    { userId: uid, lessonId, today, score, reviewed, signsLearnedDelta, alphabetComplete },
  );
  return ok(result);
});

/** GET /v1/lesson/queue */
export const getDailyQueueHandler = wrap(async (event) => {
  const uid = userId(event);
  const today = event.queryStringParameters?.today ?? new Date().toISOString().slice(0, 10);

  const queue = await getDailyQueue(repo, courseConfig(), { userId: uid, today });
  return ok({ queue });
});
