/**
 * Gatilho PreSignUp do Cognito: uma pessoa, uma conta, pelo e-mail ou pelo Google.
 *
 * O Cognito chama com `triggerSource`:
 *   PreSignUp_ExternalProvider  primeiro login pelo Google. Se ja existe conta de e-mail e senha
 *                               confirmada com o mesmo e-mail verificado, liga o Google a ela
 *                               (AdminLinkProviderForUser): dai em diante o Google entra nessa conta,
 *                               com o mesmo sub e o mesmo progresso. Sem conta assim, segue e o
 *                               Cognito cria a conta do Google, como antes.
 *   PreSignUp_SignUp            cadastro com e-mail e senha. Se o e-mail ja e de uma conta do Google,
 *                               recusa (LIBRAX_EMAIL_DO_GOOGLE): o app pede para entrar pelo Google.
 *   PreSignUp_AdminCreateUser   conta criada pelo console: segue.
 *
 * Depois de ligar, o Cognito ainda tenta criar a conta do Google nesse mesmo login e falha. Para a
 * volta ser sempre a mesma, o gatilho recusa com LIBRAX_CONTA_LIGADA: o app (AuthCallbackScreen) ve
 * a marca na volta e repete o login pelo Google uma vez, que agora entra na conta ligada.
 *
 * So liga quando os dois lados provam o e-mail: a conta de senha confirmada (CONFIRMED, com
 * email_verified) e o Google dizendo que o e-mail e verificado. Assim ninguem cadastra o e-mail de
 * outra pessoa com senha para receber o Google dela.
 *
 * Sem variavel de ambiente: o id do User Pool vem no proprio evento (evita a dependencia circular
 * entre o User Pool e o gatilho na stack).
 */

import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export const LINKED_MARKER = 'LIBRAX_CONTA_LIGADA';
export const GOOGLE_EMAIL_MARKER = 'LIBRAX_EMAIL_DO_GOOGLE';

/** Prefixo do username das contas federadas (`google_<id>`) e o nome do provedor no User Pool. */
const PROVIDERS = { google: 'Google' };

const attr = (user, name) => (user.Attributes ?? []).find((a) => a.Name === name)?.Value;
const isFederated = (user) => user.UserStatus === 'EXTERNAL_PROVIDER';

/** `google_123` -> { providerName: 'Google', providerUserId: '123' }; outro formato: null. */
export function parseFederatedUsername(userName) {
  const i = typeof userName === 'string' ? userName.indexOf('_') : -1;
  if (i <= 0) return null;
  const providerName = PROVIDERS[userName.slice(0, i).toLowerCase()];
  const providerUserId = userName.slice(i + 1);
  return providerName && providerUserId ? { providerName, providerUserId } : null;
}

export function makePreSignUpHandler({ client, log = console.log }) {
  async function usersWithEmail(userPoolId, email) {
    const { Users = [] } = await client.send(
      new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email = "${email.replace(/["\\]/g, '')}"`, Limit: 10 }),
    );
    return Users;
  }

  async function handler(event) {
    const source = event?.triggerSource;
    const email = event?.request?.userAttributes?.email?.trim().toLowerCase();
    if (!email) return event;

    if (source === 'PreSignUp_ExternalProvider') {
      const federated = parseFederatedUsername(event.userName);
      if (!federated) return event;
      if (event.request.userAttributes.email_verified !== 'true' && event.request.userAttributes.email_verified !== true) {
        return event;
      }
      const native = (await usersWithEmail(event.userPoolId, email)).find(
        (u) => !isFederated(u) && u.UserStatus === 'CONFIRMED' && attr(u, 'email_verified') === 'true',
      );
      if (!native) return event;
      await client.send(
        new AdminLinkProviderForUserCommand({
          UserPoolId: event.userPoolId,
          DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: native.Username },
          SourceUser: {
            ProviderName: federated.providerName,
            ProviderAttributeName: 'Cognito_Subject',
            ProviderAttributeValue: federated.providerUserId,
          },
        }),
      );
      // Sem e-mail nem ids no log: so o que aconteceu
      log('[pre-signup]', JSON.stringify({ linked: federated.providerName }));
      throw new Error(LINKED_MARKER);
    }

    if (source === 'PreSignUp_SignUp') {
      if ((await usersWithEmail(event.userPoolId, email)).some(isFederated)) {
        log('[pre-signup]', JSON.stringify({ refused: 'email-do-google' }));
        throw new Error(GOOGLE_EMAIL_MARKER);
      }
    }
    return event;
  }
  return { handler };
}

export const { handler } = makePreSignUpHandler({ client: new CognitoIdentityProviderClient({}) });
