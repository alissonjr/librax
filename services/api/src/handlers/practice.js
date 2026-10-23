/**
 * Handler Lambda da pratica diaria (aba Praticar, SPEC 03 secao 11.12).
 *
 * POST /v1/practice/review -> reviewSignsOnce (idempotente com reviewAttemptId)
 *
 * Grava no SRS a resposta de cada sinal revisado. Nao concede XP nem mexe na ofensiva
 * (isso e do POST /v1/lesson/complete).
 *
 * `makePracticeHandlers({ repo, catalog })` recebe as dependencias (testes usam InMemoryRepo);
 * o export nomeado e a instancia de producao (DynamoRepo + catalogo empacotado).
 */

import { reviewSignsOnce } from '../usecases/reviewSigns.js';
import { parsePracticeReview } from '../domain/practiceReview.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { courseCatalog } from './_catalog.js';

const utcDay = (d) => d.toISOString().slice(0, 10);

export function makePracticeHandlers({ repo, catalog, now = () => new Date() }) {
  /** POST /v1/practice/review */
  const reviewSignsHandler = wrap(async (event) => {
    const uid = userId(event);
    const raw = body(event);
    const today = utcDay(now());
    const parsed = parsePracticeReview(raw, { catalog, today });
    if (!parsed.ok) throw new ApiError(400, parsed.error, `Revisao invalida: ${parsed.error}`);

    return ok(await reviewSignsOnce(repo, { ...parsed.value, userId: uid }));
  });

  return { reviewSignsHandler };
}

export const { reviewSignsHandler } = makePracticeHandlers({
  repo: dynamoRepo,
  catalog: courseCatalog,
});
