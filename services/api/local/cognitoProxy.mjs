/**
 * Proxy do cognito-idp (POST / com X-Amz-Target) para o Amplify do app: o app aponta
 * `Auth.Cognito.userPoolEndpoint` para ca (VITE_COGNITO_ENDPOINT) so no modo local.
 *
 * Repassa tudo ao moto, menos o que ele nao faz como o Cognito:
 * - USER_SRP_AUTH: troca SALT, SRP_B e SECRET_BLOCK pelos do verificador guardado e confere a
 *   PASSWORD_CLAIM_SIGNATURE antes de repassar (o moto aceita qualquer assinatura).
 * - ExplicitAuthFlows do client (o moto nao confere).
 * - SignUp, ConfirmSignUp, ResendConfirmationCode, ForgotPassword e ConfirmForgotPassword: o
 *   codigo e gerado e conferido aqui; a senha passa pelo verificador; o PostConfirmation roda.
 * - ChangePassword e AdminSetUserPassword atualizam o verificador.
 * - RevokeToken (inexistente no moto): responde vazio, como o Cognito.
 * - PreventUserExistenceErrors: conta inexistente vira NotAuthorizedException no login.
 */

import { motoRaw, CognitoError, COGNITO_TARGET_PREFIX } from './moto.mjs';
import { maskEmail } from './cognitoLocal.mjs';
import { startChallenge, verifyClaim, newSecretBlock } from './srp.mjs';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const BAD_LOGIN = 'Incorrect username or password.';

const FLOW_PERMISSION = {
  USER_SRP_AUTH: 'ALLOW_USER_SRP_AUTH',
  USER_PASSWORD_AUTH: 'ALLOW_USER_PASSWORD_AUTH',
  REFRESH_TOKEN_AUTH: 'ALLOW_REFRESH_TOKEN_AUTH',
  REFRESH_TOKEN: 'ALLOW_REFRESH_TOKEN_AUTH',
  CUSTOM_AUTH: 'ALLOW_CUSTOM_AUTH',
};

export function makeCognitoProxy({ local, log = console.log }) {
  const { userPoolId, clientsById, srpStore } = local;
  const challenges = new Map();

  function client(clientId) {
    const c = clientsById.get(clientId);
    if (!c) throw new CognitoError('ResourceNotFoundException', `User pool client ${clientId} does not exist.`);
    return c;
  }

  const hidesUsers = (clientId) => clientsById.get(clientId)?.props.PreventUserExistenceErrors === 'ENABLED';

  async function forward(target, body) {
    const res = await motoRaw(target, JSON.stringify(body));
    const json = res.text ? JSON.parse(res.text) : {};
    if (res.status >= 400) {
      throw new CognitoError(String(json.__type ?? 'UnknownError'), json.message, res.status);
    }
    return json;
  }

  async function initiateAuth(body) {
    const c = client(body.ClientId);
    const needed = FLOW_PERMISSION[body.AuthFlow];
    if (needed && !(c.props.ExplicitAuthFlows ?? []).includes(needed)) {
      throw new CognitoError('InvalidParameterException', `${body.AuthFlow} flow not enabled for this client`);
    }
    if (body.AuthFlow !== 'USER_SRP_AUTH') return forward('InitiateAuth', body);

    let res;
    try {
      res = await forward('InitiateAuth', body);
    } catch (err) {
      if (err.type === 'UserNotFoundException' && hidesUsers(body.ClientId)) throw new CognitoError('NotAuthorizedException', BAD_LOGIN);
      throw err;
    }
    const params = res.ChallengeParameters ?? {};
    const userId = params.USER_ID_FOR_SRP;
    const saved = srpStore.get(userPoolId, userId);
    if (!saved) {
      log(`[cognito local] conta ${userId} sem verificador SRP (senha criada fora do ambiente local)`);
      throw new CognitoError('NotAuthorizedException', BAD_LOGIN);
    }
    const { B, state } = startChallenge({ verifier: saved.verifier, A: body.AuthParameters?.SRP_A });
    const secretBlock = newSecretBlock();
    challenges.set(secretBlock, {
      motoBlock: params.SECRET_BLOCK,
      userId,
      verifier: saved.verifier,
      state,
      clientId: body.ClientId,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return { ...res, ChallengeParameters: { ...params, SALT: saved.salt, SRP_B: B, SECRET_BLOCK: secretBlock } };
  }

  async function respondToAuthChallenge(body) {
    if (body.ChallengeName !== 'PASSWORD_VERIFIER') return forward('RespondToAuthChallenge', body);
    const answers = body.ChallengeResponses ?? {};
    const pending = challenges.get(answers.PASSWORD_CLAIM_SECRET_BLOCK);
    challenges.delete(answers.PASSWORD_CLAIM_SECRET_BLOCK);
    if (!pending || pending.expiresAt < Date.now() || pending.clientId !== body.ClientId) {
      throw new CognitoError('NotAuthorizedException', 'Invalid session for the user, session is expired.');
    }
    const ok = verifyClaim({
      userPoolId,
      userId: pending.userId,
      verifier: pending.verifier,
      state: pending.state,
      secretBlock: answers.PASSWORD_CLAIM_SECRET_BLOCK,
      timestamp: answers.TIMESTAMP,
      claimSignature: answers.PASSWORD_CLAIM_SIGNATURE,
    });
    if (!ok) throw new CognitoError('NotAuthorizedException', BAD_LOGIN);
    return forward('RespondToAuthChallenge', {
      ...body,
      ChallengeResponses: { ...answers, PASSWORD_CLAIM_SECRET_BLOCK: pending.motoBlock },
    });
  }

  const delivery = (email) => ({ Destination: maskEmail(email), DeliveryMedium: 'EMAIL', AttributeName: 'email' });

  async function signUp(body) {
    client(body.ClientId);
    const res = await forward('SignUp', body);
    srpStore.setPassword(userPoolId, res.UserSub, body.Password);
    const email = (body.UserAttributes ?? []).find((a) => a.Name === 'email')?.Value ?? body.Username;
    local.issueCode(body.Username, email, 'cadastro');
    return { ...res, CodeDeliveryDetails: delivery(email) };
  }

  async function confirmSignUp(body) {
    client(body.ClientId);
    const user = await local.getUser(body.Username).catch(() => null);
    if (!user) throw new CognitoError('UserNotFoundException', 'Username/client id combination not found.');
    if (user.status === 'CONFIRMED') throw new CognitoError('NotAuthorizedException', 'User cannot be confirmed. Current status is CONFIRMED');
    local.checkCode(body.Username, 'cadastro', body.ConfirmationCode);
    const res = await forward('ConfirmSignUp', body);
    await local.postConfirmation('PostConfirmation_ConfirmSignUp', user, body.ClientId);
    return res;
  }

  async function resendConfirmationCode(body) {
    client(body.ClientId);
    const user = await local.getUser(body.Username).catch(() => null);
    if (!user) throw new CognitoError('UserNotFoundException', 'Username/client id combination not found.');
    local.issueCode(body.Username, user.attributes.email, 'cadastro');
    return { CodeDeliveryDetails: delivery(user.attributes.email) };
  }

  async function forgotPassword(body) {
    client(body.ClientId);
    const user = await local.getUser(body.Username).catch(() => null);
    // com PreventUserExistenceErrors o Cognito finge que mandou
    if (!user) return { CodeDeliveryDetails: delivery(body.Username) };
    local.issueCode(body.Username, user.attributes.email, 'nova senha');
    return { CodeDeliveryDetails: delivery(user.attributes.email) };
  }

  async function confirmForgotPassword(body) {
    client(body.ClientId);
    local.checkCode(body.Username, 'nova senha', body.ConfirmationCode);
    const user = await local.getUser(body.Username);
    await local.setPassword(user.username, body.Password);
    await local.postConfirmation('PostConfirmation_ConfirmForgotPassword', user, body.ClientId);
    return {};
  }

  async function changePassword(body) {
    const res = await forward('ChangePassword', body);
    const me = await forward('GetUser', { AccessToken: body.AccessToken });
    const sub = (me.UserAttributes ?? []).find((a) => a.Name === 'sub')?.Value;
    if (sub) srpStore.setPassword(userPoolId, sub, body.ProposedPassword);
    return res;
  }

  async function adminSetUserPassword(body) {
    const res = await forward('AdminSetUserPassword', body);
    const user = await local.getUser(body.Username);
    srpStore.setPassword(body.UserPoolId, user.attributes.sub, body.Password);
    return res;
  }

  const handlers = {
    InitiateAuth: initiateAuth,
    RespondToAuthChallenge: respondToAuthChallenge,
    SignUp: signUp,
    ConfirmSignUp: confirmSignUp,
    ResendConfirmationCode: resendConfirmationCode,
    ForgotPassword: forgotPassword,
    ConfirmForgotPassword: confirmForgotPassword,
    ChangePassword: changePassword,
    AdminSetUserPassword: adminSetUserPassword,
    RevokeToken: async () => ({}),
  };

  /**
   * @param {string} amzTarget  cabecalho X-Amz-Target
   * @param {string} rawBody
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  async function handle(amzTarget, rawBody) {
    const target = String(amzTarget ?? '').replace(COGNITO_TARGET_PREFIX, '');
    const json = { 'Content-Type': 'application/x-amz-json-1.1' };
    try {
      const handler = handlers[target];
      if (!handler) {
        const res = await motoRaw(target, rawBody);
        const errorType = res.headers.get('x-amzn-errortype');
        log(`[cognito] ${target} -> ${res.status} (moto)`);
        return { status: res.status, headers: { ...json, ...(errorType ? { 'x-amzn-ErrorType': errorType } : {}) }, body: res.text };
      }
      const body = rawBody ? JSON.parse(rawBody) : {};
      const out = await handler(body);
      log(`[cognito] ${target} -> 200`);
      return { status: 200, headers: json, body: JSON.stringify(out) };
    } catch (err) {
      if (!(err instanceof CognitoError)) {
        log('[cognito local] erro no proxy', target, err);
        err = new CognitoError('InternalErrorException', 'erro no proxy local', 500);
      }
      log(`[cognito] ${target} -> ${err.status ?? 400} ${err.type}`);
      return {
        status: err.status ?? 400,
        headers: { ...json, 'x-amzn-ErrorType': err.type },
        body: JSON.stringify({ __type: err.type, message: err.message }),
      };
    }
  }

  return { handle, challenges };
}
