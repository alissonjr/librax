/**
 * Handler Lambda da exclusao de conta pela propria pessoa (LGPD, spec-02 secoes 11 e 12.8).
 *
 * DELETE /v1/users/me  -> deleteAccount: squads, ligas, a particao USER#<id> e, por ultimo, o
 *                         usuario no Cognito (AdminDeleteUser, tambem para conta do Google)
 *
 * Mesmo autorizador JWT das outras rotas da pessoa: so o sub do token decide de quem e a conta.
 * O `cognito:username` do id token e o nome que o AdminDeleteUser pede (conta do Google:
 * `google_<id>`). Responde 200 so depois de tudo apagado; erro no meio vira 500 e a nova
 * tentativa termina o servico (o usecase e idempotente). O log leva so contagens.
 *
 * `makeAccountHandlers({ repo, directory })` recebe as dependencias (testes usam InMemoryRepo
 * e um diretorio falso); o export nomeado e a instancia de producao (DynamoRepo e Cognito).
 */

import { deleteAccount } from '../usecases/deleteAccount.js';
import { userId, claims, ok, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { CognitoDirectory, makeCognitoClient } from '../adapters/cognitoDirectory.js';

export function makeAccountHandlers({ repo, directory, log = console.log }) {
  /** DELETE /v1/users/me */
  const deleteAccountHandler = wrap(async (event) => {
    const uid = userId(event);
    const username = claims(event)['cognito:username'] ?? uid;
    const report = await deleteAccount(repo, { userId: uid, username, directory });
    log('[deleteAccount]', JSON.stringify(report));
    return ok({ ok: true });
  });

  return { deleteAccountHandler };
}

export const { deleteAccountHandler } = makeAccountHandlers({
  repo: dynamoRepo,
  directory: new CognitoDirectory(makeCognitoClient(), process.env.USER_POOL_ID),
});
