/**
 * Diretorio de contas sobre o User Pool do Cognito (painel de administracao, tela Contas).
 *
 * O e-mail so existe no Cognito (a tabela guarda o perfil pelo sub), entao a busca usa o
 * ListUsers com filtro: `email ^= "<comeco>"` ou `sub = "<id>"`. O ListUsers nao e cobrado (o
 * Cognito cobra por usuario ativo no mes) e o painel so chama quando alguem busca.
 *
 * Requer `cognito-idp:ListUsers` no User Pool. A exclusao de conta (DELETE /v1/users/me) usa so
 * `deleteUser`, com `cognito-idp:AdminDeleteUser` numa Lambda propria.
 */

import {
  AdminDeleteUserCommand,
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

  async get(userId) {
    const [account] = await this.search({ kind: 'sub', term: userId }, { limit: 1 });
    return account ?? null;
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
