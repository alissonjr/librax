/**
 * Handler Lambda do perfil de quem estuda (o nome dos rankings e a escolha do ranking global).
 *
 * PUT /v1/users/me/profile -> updateProfile, corpo { displayName?, showInGlobalRanking? } (pelo
 *                             menos um) e `keepExistingName` opcional; resposta
 *                             { displayName, showInGlobalRanking }
 *
 * `keepExistingName: true` e o envio automatico do app (abertura e login): o nome so entra se a
 * conta ainda nao tiver um, e a resposta traz o nome que vale. A troca feita pela pessoa em
 * Configuracoes vai sem ele e sempre grava.
 *
 * O nome e o do onboarding (1 a 30 caracteres depois da limpeza, domain/profile.js) e vai tambem
 * para a liga da semana e as squads da pessoa. Mesmo autorizador JWT das outras rotas da pessoa:
 * so o sub do token decide de quem e o perfil.
 *
 * `makeProfileHandlers({ repo, now })` recebe as dependencias (testes usam InMemoryRepo); o
 * export nomeado e a instancia de producao (DynamoRepo).
 */

import { parseProfileUpdate } from '../domain/profile.js';
import { updateProfile } from '../usecases/profile.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

const PROFILE_ERRORS = {
  INVALID_NAME: 'displayName deve ter de 1 a 30 caracteres',
  INVALID_RANKING_CHOICE: 'showInGlobalRanking deve ser true ou false',
  NO_CHANGES: 'Mande displayName, showInGlobalRanking ou os dois',
  INVALID_KEEP_NAME: 'keepExistingName deve ser true ou false',
};

export function makeProfileHandlers({ repo, now = () => new Date() }) {
  /** PUT /v1/users/me/profile */
  const updateProfileHandler = wrap(async (event) => {
    const uid = userId(event);
    const parsed = parseProfileUpdate(body(event, { maxBytes: 1024 }));
    if (!parsed.ok) throw new ApiError(400, parsed.error, PROFILE_ERRORS[parsed.error]);
    return ok(await updateProfile(repo, {
      userId: uid, changes: parsed.changes, keepExistingName: parsed.keepExistingName, nowMs: now().getTime(),
    }));
  });
  return { updateProfileHandler };
}

export const { updateProfileHandler } = makeProfileHandlers({ repo: dynamoRepo });
