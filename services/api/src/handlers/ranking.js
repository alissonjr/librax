/**
 * Handler Lambda do ranking global de todos os tempos (XP total do perfil).
 *
 * GET /v1/ranking/global -> getGlobalRanking: { top: [{ rank, name, xp, isYou }] (os 50 de
 *                           maior XP), you: { rank, xp, listed } }
 *
 * Posicao por competicao (empate divide a posicao). Nunca devolve o id de ninguem; quem saiu do
 * ranking (PUT /v1/users/me/profile, showInGlobalRanking: false) nao aparece e recebe rank null.
 *
 * `makeRankingHandlers({ repo })` recebe as dependencias (testes usam InMemoryRepo); o export
 * nomeado e a instancia de producao (DynamoRepo).
 */

import { getGlobalRanking } from '../usecases/globalRanking.js';
import { userId, ok, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

export function makeRankingHandlers({ repo }) {
  /** GET /v1/ranking/global */
  const getGlobalRankingHandler = wrap(async (event) => {
    const uid = userId(event);
    return ok(await getGlobalRanking(repo, { userId: uid }));
  });
  return { getGlobalRankingHandler };
}

export const { getGlobalRankingHandler } = makeRankingHandlers({ repo: dynamoRepo });
