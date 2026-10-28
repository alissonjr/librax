/**
 * Diretorio de contas sobre o User Pool do Cognito (painel de administracao, tela Contas).
 *
 * O e-mail so existe no Cognito (a tabela guarda o perfil pelo sub), entao a busca usa o
 * ListUsers com filtro: `email ^= "<comeco>"` ou `sub = "<id>"`, e a listagem usa o ListUsers sem
 * filtro, uma pagina por chamada (PaginationToken). O ListUsers nao e cobrado (o Cognito cobra por
 * usuario ativo no mes) e o painel so chama quando alguem abre a tela, busca ou troca de pagina.
 * A ordem da listagem e a do Cognito (ele nao ordena por data).
 *
 * Requer `cognito-idp:ListUsers` no User Pool, e `cognito-idp:AdminGetUser` para `totpEnabled` (o
 * painel exige o aplicativo autenticador de quem e admin). A exclusao de conta (DELETE /v1/users/me)
 * usa so `deleteUser`, com `cognito-idp:AdminDeleteUser` numa Lambda propria.
 */

import {
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export function makeCognitoClient(options = {}) {
  return new CognitoIdentityProviderClient(options);
}

/** Conta como o painel mostra: so o que ajuda a reconhecer a pessoa, sem tokens nem senha. */
export function accountFromCognito(user) {
  const attrs = Object.fromEntries((user.Attributes ?? []).map((a) => [a.Name, a.Value]));
  let provider = 'email';
  try {
    const identities = JSON.parse(attrs.identities ?? '[]');
    if (identities[0]?.providerName) provider = identities[0].providerName;
  } catch {
    // sem identidades federadas: conta de e-mail e senha
  }
  const created = user.UserCreateDate;
  return {
    userId: attrs.sub ?? null,
    email: attrs.email ?? null,
    emailVerified: attrs.email_verified === 'true',
    name: attrs.given_name ?? attrs.name ?? null,
    provider,
    status: user.UserStatus ?? null,
    enabled: user.Enabled !== false,
    createdAt: created instanceof Date ? created.toISOString() : created ?? null,
  };
}

export class CognitoDirectory {
  /**
   * @param {{send: Function}} client   CognitoIdentityProviderClient (ou um falso nos testes)
   * @param {string} userPoolId
   */
  constructor(client, userPoolId) {
    this._client = client;
    this._userPoolId = userPoolId;
  }

  /**
   * @param {{kind: 'sub'|'email', term: string}} query  ja normalizada (domain/admin.js)
   * @returns {Promise<object[]>}
   */
  async search({ kind, term }, { limit = 10 } = {}) {
    const Filter = kind === 'sub' ? `sub = "${term}"` : `email ^= "${term}"`;
    const { Users = [] } = await this._client.send(
      new ListUsersCommand({ UserPoolId: this._userPoolId, Filter, Limit: limit }),
    );
    return Users.map(accountFromCognito);
  }

  /**
   * Uma pagina de contas, sem filtro. `cursor` e o PaginationToken da pagina anterior.
   * @returns {Promise<{accounts: object[], cursor: string|null}>}
   */
  async list({ limit = 25, cursor = null } = {}) {
    const out = await this._client.send(
      new ListUsersCommand({ UserPoolId: this._userPoolId, Limit: limit, ...(cursor ? { PaginationToken: cursor } : {}) }),
    );
    return { accounts: (out.Users ?? []).map(accountFromCognito), cursor: out.PaginationToken ?? null };
  }

  async get(userId) {
    const [account] = await this.search({ kind: 'sub', term: userId }, { limit: 1 });
    return account ?? null;
  }

  /**
   * A conta tem o aplicativo autenticador (TOTP) ligado? `username` e o `cognito:username` do id token.
   * Com ele ligado, o Cognito pede o codigo em todo login da conta. Conta que nao existe: nao.
   * @returns {Promise<boolean>}
   */
  async totpEnabled(username) {
    try {
      const out = await this._client.send(new AdminGetUserCommand({ UserPoolId: this._userPoolId, Username: username }));
      return (out.UserMFASettingList ?? []).includes('SOFTWARE_TOKEN_MFA');
    } catch (e) {
      if (e?.name === 'UserNotFoundException') return false;
      throw e;
    }
  }

  /**
   * Apaga o usuario do User Pool (exclusao de conta). `username` e o `cognito:username` do id
   * token: o sub nas contas de e-mail, `google_<id>` nas do Google. Usuario que ja nao existe
   * conta como feito, para a nova tentativa terminar sem erro.
   * @returns {Promise<boolean>} false se ja nao existia
   */
  async deleteUser(username) {
    try {
      await this._client.send(new AdminDeleteUserCommand({ UserPoolId: this._userPoolId, Username: username }));
      return true;
    } catch (e) {
      if (e?.name === 'UserNotFoundException') return false;
      throw e;
    }
  }
}
