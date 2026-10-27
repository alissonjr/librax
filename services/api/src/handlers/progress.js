/**
 * Progresso da conta para o app gravar no aparelho (entrar no comeco do app ou num aparelho novo).
 *
 * GET /v1/users/me/progress -> exportProgress: licoes, revisoes, XP por dia, conquistas e o resumo
 *                              do perfil. So le; o nome vem do perfil ou, sem ele, do token (`given_name`).
 *
 * Mesmo autorizador JWT das outras rotas da pessoa: so o sub do token decide de quem e o progresso.
 */

import { exportProgress } from '../usecases/exportProgress.js';
import { userId, claims, ok, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

export function makeProgressHandlers({ repo }) {
  /** GET /v1/users/me/progress */
  const getProgressHandler = wrap(async (event) => {
    const uid = userId(event);
    // Cadastro do app e Google gravam o primeiro nome em given_name; `name` fica de reserva
    const { given_name: givenName, name } = claims(event);
    return ok(await exportProgress(repo, { userId: uid, name: givenName ?? name ?? null }));
  });
  return { getProgressHandler };
}

export const { getProgressHandler } = makeProgressHandlers({ repo: dynamoRepo });
