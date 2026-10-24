/**
 * O que o Cognito faz e o moto nao: codigo de confirmacao conferido, caixa de e-mails simulada,
 * verificador SRP junto com a senha e o gatilho PostConfirmation. Usado pelo proxy
 * (cognitoProxy.mjs), pela pagina de login (hostedUi.mjs) e pela semente (seed.mjs).
 */

import { randomInt, randomBytes } from 'node:crypto';
import { cognito, attrsOf, CognitoError } from './moto.mjs';
import { makeSrpStore } from './srpStore.mjs';

const CODE_TTL_MS = 24 * 60 * 60 * 1000;
const INBOX_MAX = 30;

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** "a***@e***" como o CodeDeliveryDetails do Cognito. */
export function maskEmail(email) {
  const [user, domain = ''] = String(email).split('@');
  return `${user.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

/**
 * @param {object} deps
 * @param {object} deps.state        state.json (userPoolId, clients)
 * @param {object} deps.plan         plano do template (gatilho PostConfirmation)
 * @param {(name: string, event: object) => Promise<object>} deps.invoke  funcoes locais
 */
export function makeCognitoLocal({ state, plan, invoke, srpStore = makeSrpStore(), log = console.log }) {
  const userPoolId = state.userPoolId;
  const codes = new Map();
  const inbox = [];

  const clientsById = new Map(Object.values(state.clients).map((c) => [c.clientId, c]));

  /** Codigo de 6 digitos "enviado por e-mail": vai para o log e para a caixa simulada. */
  function issueCode(username, email, purpose) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    codes.set(`${purpose}:${norm(username)}`, { code, expiresAt: Date.now() + CODE_TTL_MS });
    inbox.unshift({ to: email ?? username, purpose, code, at: new Date().toISOString() });
    inbox.length = Math.min(inbox.length, INBOX_MAX);
    log(`[cognito local] codigo de ${purpose} para ${email ?? username}: ${code}`);
    return code;
  }

  /** Confere e consome o codigo (uso unico). */
  function checkCode(username, purpose, code) {
    const k = `${purpose}:${norm(username)}`;
    const saved = codes.get(k);
    if (!saved || saved.expiresAt < Date.now()) {
      throw new CognitoError('ExpiredCodeException', 'Invalid code provided, please request a code again.');
    }
    if (saved.code !== String(code ?? '').trim()) {
      throw new CognitoError('CodeMismatchException', 'Invalid verification code provided, please try again.');
    }
    codes.delete(k);
  }

  async function findByEmail(email) {
    const { Users = [] } = await cognito('ListUsers', {
      UserPoolId: userPoolId,
      Filter: `email = "${norm(email).replace(/["\\]/g, '')}"`,
      Limit: 1,
    });
    const user = Users[0];
    return user ? { username: user.Username, status: user.UserStatus, attributes: attrsOf(user.Attributes) } : null;
  }

  async function getUser(username) {
    const user = await cognito('AdminGetUser', { UserPoolId: userPoolId, Username: username });
    return { username: user.Username, status: user.UserStatus, attributes: attrsOf(user.UserAttributes) };
  }

  /** Senha nova no moto (que confere no USER_PASSWORD_AUTH) e o verificador SRP. */
  async function setPassword(username, password) {
    await cognito('AdminSetUserPassword', { UserPoolId: userPoolId, Username: username, Password: password, Permanent: true });
    const { attributes } = await getUser(username);
    srpStore.setPassword(userPoolId, attributes.sub, password);
  }

  /**
   * Gatilho PostConfirmation, com o evento que o Cognito manda. O handler devolve o evento; erro
   * nele impede a confirmacao, como na AWS (UserLambdaValidationException).
   */
  async function postConfirmation(triggerSource, { username, attributes }, clientId = null, now = undefined) {
    const fn = plan.userPool.postConfirmation;
    if (!fn) return;
    const event = {
      version: '1',
      region: state.region,
      userPoolId,
      userName: username,
      callerContext: { awsSdkVersion: 'local', clientId },
      triggerSource,
      request: { userAttributes: { ...attributes, 'cognito:user_status': 'CONFIRMED' } },
      response: {},
    };
    try {
      await invoke(fn, event, now);
    } catch (err) {
      throw new CognitoError('UserLambdaValidationException', `PostConfirmation failed with error ${err.message}.`);
    }
  }

  /**
   * Conta pronta para entrar (semente e "Google simulado"): cria, define a senha e poe nos grupos.
   * Senha `null` = conta sem senha conhecida (Google): fica uma aleatoria, sem verificador SRP.
   */
  async function createAccount({ email, password = null, name = null, groups = [], provider = null }) {
    const attributes = [
      { Name: 'email', Value: norm(email) },
      { Name: 'email_verified', Value: 'true' },
      ...(name ? [{ Name: 'given_name', Value: name }] : []),
    ];
    if (provider) {
      attributes.push({
        Name: 'identities',
        Value: JSON.stringify([{ providerName: provider, providerType: provider, userId: randomBytes(10).toString('hex'), primary: true }]),
      });
    }
    const { User } = await cognito('AdminCreateUser', {
      UserPoolId: userPoolId,
      Username: norm(email),
      UserAttributes: attributes,
      MessageAction: 'SUPPRESS',
    });
    if (password) await setPassword(User.Username, password);
    else await cognito('AdminSetUserPassword', { UserPoolId: userPoolId, Username: User.Username, Password: randomBytes(24).toString('base64url'), Permanent: true });
    for (const group of groups) {
      await cognito('AdminAddUserToGroup', { UserPoolId: userPoolId, Username: User.Username, GroupName: group });
    }
    return getUser(User.Username);
  }

  /**
   * Tokens do moto para quem a pagina de login ja autenticou (como o Hosted UI faz por dentro).
   * Sem senha (Google simulado): troca por uma aleatoria e entra com ela.
   */
  async function tokensFor({ clientId, username, password = null }) {
    let pass = password;
    if (pass === null) {
      pass = randomBytes(24).toString('base64url');
      await cognito('AdminSetUserPassword', { UserPoolId: userPoolId, Username: username, Password: pass, Permanent: true });
    }
    const res = await cognito('AdminInitiateAuth', {
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD: pass },
    });
    if (!res.AuthenticationResult) throw new CognitoError('NotAuthorizedException', `desafio inesperado: ${res.ChallengeName}`);
    return res.AuthenticationResult;
  }

  async function refreshTokens({ clientId, refreshToken }) {
    const res = await cognito('InitiateAuth', {
      ClientId: clientId,
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    return { ...res.AuthenticationResult, RefreshToken: refreshToken };
  }

  return {
    userPoolId,
    clientsById,
    inbox,
    issueCode,
    checkCode,
    findByEmail,
    getUser,
    setPassword,
    postConfirmation,
    createAccount,
    tokensFor,
    refreshTokens,
    srpStore,
  };
}
