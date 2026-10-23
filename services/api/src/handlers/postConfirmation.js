/**
 * Gatilho PostConfirmation do Cognito: conta as contas novas do painel de administracao
 * (OPS / DAY#<dia>, WEEK# e MONTH#, no dia de Brasilia).
 *
 * O Cognito chama com `triggerSource`:
 *   PostConfirmation_ConfirmSignUp          cadastro confirmado (e-mail) ou primeiro login social
 *   PostConfirmation_ConfirmForgotPassword  troca de senha: nao e conta nova, nao conta
 *
 * O gatilho precisa devolver o proprio evento, e um erro aqui impediria o cadastro: por isso a
 * falha do contador so vai para o log.
 *
 * `makePostConfirmationHandler({ repo, now })` recebe as dependencias (testes usam InMemoryRepo);
 * `handler` e a instancia de producao (DynamoRepo).
 */

import { opsToday } from '../domain/opsMetrics.js';
import { quietly, recordNewAccount } from '../usecases/opsMetrics.js';
import { repo as dynamoRepo } from './_repo.js';

export function makePostConfirmationHandler({ repo, now = () => new Date() }) {
  async function handler(event) {
    if (event?.triggerSource === 'PostConfirmation_ConfirmSignUp') {
      await quietly('conta nova', () => recordNewAccount(repo, { day: opsToday(now()) }));
    }
    return event;
  }
  return { handler };
}

export const { handler } = makePostConfirmationHandler({ repo: dynamoRepo });
