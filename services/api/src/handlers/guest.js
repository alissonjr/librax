/**
 * POST /v1/guest/migrate (SPEC 02 secoes 2 e 12.2; plano mobile web 3.6, fase W3).
 *
 * Chamado pelo app logo depois de criar conta (ou entrar numa conta) com o JWT do User Pool.
 * Corpo: { entries: [{ lessonAttemptId, lessonId, today, score, completedAt?, reviewed?,
 * signsLearnedDelta? }] } - o log local de conclusoes do convidado (fila offline do app).
 *
 * Resposta 200: { results: [{ lessonAttemptId, status: applied|duplicate|rejected, ... }],
 * summary: { applied, duplicate, rejected }, profile: { xpTotal, streak } }.
 * O app apaga da fila tudo que voltou com status (inclusive rejected: nao adianta reenviar).
 *
 * Erros: 401 sem token; 413 corpo acima de LIMITS.maxBodyBytes; 400 BAD_JSON, BAD_PAYLOAD,
 * EMPTY_LOG, TOO_MANY_ENTRIES (o app manda em lotes de ate LIMITS.maxEntries).
 */

import { migrateGuest } from '../usecases/migrateGuest.js';
import { LIMITS } from '../domain/lessonCompletion.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { courseCatalog } from './_catalog.js';

const PAYLOAD_ERRORS = {
  BAD_PAYLOAD: 'Esperado { entries: [...] }',
  EMPTY_LOG: 'Nenhuma conclusao enviada',
  TOO_MANY_ENTRIES: `No maximo ${LIMITS.maxEntries} conclusoes por envio`,
};

export function makeGuestHandlers({ repo, catalog, now = () => new Date() }) {
  const migrateGuestHandler = wrap(async (event) => {
    const uid = userId(event);
    const payload = body(event, { maxBytes: LIMITS.maxBodyBytes });
    try {
      return ok(await migrateGuest(repo, catalog, { userId: uid, payload, now: now() }));
    } catch (err) {
      if (PAYLOAD_ERRORS[err.message]) throw new ApiError(400, err.message, PAYLOAD_ERRORS[err.message]);
      throw err;
    }
  });
  return { migrateGuestHandler };
}

export const { migrateGuestHandler } = makeGuestHandlers({ repo: dynamoRepo, catalog: courseCatalog });
