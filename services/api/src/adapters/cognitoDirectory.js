/**
 * Diretorio de contas sobre o User Pool do Cognito (painel de administracao, tela Contas).
 *
 * O e-mail so existe no Cognito (a tabela guarda o perfil pelo sub), entao a busca usa o
 * ListUsers com filtro: `email ^= "<comeco>"` ou `sub = "<id>"`. O ListUsers nao e cobrado (o
 * Cognito cobra por usuario ativo no mes) e o painel so chama quando alguem busca.
 *
 * Requer `cognito-idp:ListUsers` no User Pool.
 */

import { CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';

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
}
