import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makePreSignUpHandler, parseFederatedUsername, LINKED_MARKER, GOOGLE_EMAIL_MARKER } from '../src/handlers/preSignUp.js';

// Gatilho PreSignUp: liga o Google a conta de e-mail e senha com o mesmo e-mail, e recusa cadastro
// com senha de e-mail que ja entra pelo Google. Cognito falso: anota as chamadas.

const POOL = 'us-east-1_pool';

function fakeCognito(users) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      if (cmd.constructor.name === 'ListUsersCommand') {
        const email = /email = "(.*)"/.exec(cmd.input.Filter)[1];
        return { Users: users.filter((u) => u.Attributes.some((a) => a.Name === 'email' && a.Value === email)) };
      }
      return {};
    },
  };
}

const nativeUser = (over = {}) => ({
  Username: 'aaaa-1111',
  UserStatus: 'CONFIRMED',
  Attributes: [
    { Name: 'email', Value: 'ana@exemplo.com' },
    { Name: 'email_verified', Value: 'true' },
  ],
  ...over,
});
const googleUser = { Username: 'google_999', UserStatus: 'EXTERNAL_PROVIDER', Attributes: [{ Name: 'email', Value: 'ana@exemplo.com' }] };

const googleEvent = (over = {}) => ({
  triggerSource: 'PreSignUp_ExternalProvider',
  userPoolId: POOL,
  userName: 'google_123456',
  request: { userAttributes: { email: 'Ana@Exemplo.com', email_verified: 'true' } },
  response: {},
  ...over,
});

function setup(users) {
  const client = fakeCognito(users);
  const logs = [];
  const { handler } = makePreSignUpHandler({ client, log: (...a) => logs.push(a.join(' ')) });
  return { handler, client, logs };
}

test('username federado vira provedor e id', () => {
  assert.deepEqual(parseFederatedUsername('google_123'), { providerName: 'Google', providerUserId: '123' });
  assert.deepEqual(parseFederatedUsername('Google_123'), { providerName: 'Google', providerUserId: '123' });
  assert.equal(parseFederatedUsername('facebook_1'), null);
  assert.equal(parseFederatedUsername('semprefixo'), null);
  assert.equal(parseFederatedUsername(undefined), null);
});

test('primeiro login pelo Google com conta de senha confirmada: liga e pede para repetir', async () => {
  const { handler, client, logs } = setup([nativeUser()]);
  await assert.rejects(handler(googleEvent()), new Error(LINKED_MARKER));
  assert.equal(client.calls[0].input.Filter, 'email = "ana@exemplo.com"');
  assert.deepEqual(client.calls[1], {
    name: 'AdminLinkProviderForUserCommand',
    input: {
      UserPoolId: POOL,
      DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: 'aaaa-1111' },
      SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: '123456' },
    },
  });
  assert.ok(logs.every((l) => !l.includes('ana@') && !l.includes('aaaa-1111')), 'sem e-mail nem id no log');
});

test('sem conta de senha, ou com ela sem confirmar: segue e o Cognito cria a conta do Google', async () => {
  for (const users of [[], [nativeUser({ UserStatus: 'UNCONFIRMED' })], [nativeUser({ Attributes: [{ Name: 'email', Value: 'ana@exemplo.com' }, { Name: 'email_verified', Value: 'false' }] })]]) {
    const { handler, client } = setup(users);
    const ev = googleEvent();
    assert.equal(await handler(ev), ev);
    assert.ok(client.calls.every((c) => c.name === 'ListUsersCommand'));
  }
});

test('Google sem e-mail verificado: nao liga nem consulta', async () => {
  const { handler, client } = setup([nativeUser()]);
  const ev = googleEvent({ request: { userAttributes: { email: 'ana@exemplo.com', email_verified: 'false' } } });
  assert.equal(await handler(ev), ev);
  assert.equal(client.calls.length, 0);
});

test('cadastro com senha de e-mail que ja entra pelo Google: recusa com a marca', async () => {
  const { handler } = setup([googleUser]);
  const ev = { triggerSource: 'PreSignUp_SignUp', userPoolId: POOL, userName: 'x', request: { userAttributes: { email: 'ana@exemplo.com' } }, response: {} };
  await assert.rejects(handler(ev), new Error(GOOGLE_EMAIL_MARKER));

  const livre = setup([nativeUser()]);
  assert.equal(await livre.handler(ev), ev);
});

test('outros gatilhos e evento sem e-mail seguem sem consultar', async () => {
  const { handler, client } = setup([nativeUser()]);
  const admin = { triggerSource: 'PreSignUp_AdminCreateUser', userPoolId: POOL, request: { userAttributes: { email: 'ana@exemplo.com' } } };
  assert.equal(await handler(admin), admin);
  const semEmail = googleEvent({ request: { userAttributes: {} } });
  assert.equal(await handler(semEmail), semEmail);
  assert.equal(client.calls.length, 0);
});
