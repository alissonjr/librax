import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeCustomMessageHandler, COGNITO_MESSAGE_MAX } from '../src/handlers/customMessage.js';

// Gatilho Custom Message do Cognito: e-mails de codigo com a identidade do Librax, por idioma.

const { handler } = makeCustomMessageHandler({ appUrl: 'https://app.librax.example', log: () => {} });

function cognitoEvent(triggerSource, { clientMetadata, userAttributes = {} } = {}) {
  return {
    version: '1',
    triggerSource,
    region: 'us-east-1',
    userPoolId: 'us-east-1_x',
    userName: 'abc',
    callerContext: { awsSdkVersion: 'x', clientId: 'c' },
    request: {
      userAttributes: { sub: 'abc', email: 'ana@exemplo.com', ...userAttributes },
      codeParameter: '{####}',
      usernameParameter: null,
      ...(clientMetadata ? { clientMetadata } : {}),
    },
    response: { smsMessage: null, emailMessage: null, emailSubject: null },
  };
}

test('cadastro: HTML com o marcador {####}, no idioma do clientMetadata', async () => {
  const out = await handler(cognitoEvent('CustomMessage_SignUp', { clientMetadata: { lang: 'en' } }));
  assert.equal(out.response.emailSubject, 'Confirm your e-mail on Librax');
  assert.match(out.response.emailMessage, /\{####\}/);
  assert.match(out.response.emailMessage, /^<!doctype html>/);
  assert.ok(out.response.emailMessage.length < COGNITO_MESSAGE_MAX);
  assert.equal(out.response.smsMessage, null);
});

test('reenvio do codigo usa o mesmo e-mail do cadastro; locale do usuario quando nao ha clientMetadata', async () => {
  const out = await handler(cognitoEvent('CustomMessage_ResendCode', { userAttributes: { locale: 'es', given_name: 'Eva' } }));
  assert.equal(out.response.emailSubject, 'Confirma tu correo en Librax');
  assert.match(out.response.emailMessage, /¡Hola, Eva!/);
});

test('nova senha: texto de "nao foi voce" e pt-BR por padrao', async () => {
  const out = await handler(cognitoEvent('CustomMessage_ForgotPassword'));
  assert.equal(out.response.emailSubject, 'Código para criar uma nova senha no Librax');
  assert.match(out.response.emailMessage, /Não foi você\?/);
  assert.match(out.response.emailMessage, /\{####\}/);
});

test('clientMetadata vale mais que o locale (idioma da tela naquele momento)', async () => {
  const out = await handler(cognitoEvent('CustomMessage_ForgotPassword', { clientMetadata: { lang: 'en' }, userAttributes: { locale: 'es' } }));
  assert.equal(out.response.emailSubject, 'Your code to create a new Librax password');
});

test('nome do usuario e escapado', async () => {
  const out = await handler(cognitoEvent('CustomMessage_SignUp', { userAttributes: { given_name: '<img src=x onerror=1>' } }));
  assert.doesNotMatch(out.response.emailMessage, /<img src=x/);
});

test('outros gatilhos (AdminCreateUser, troca de atributo) voltam sem mudanca', async () => {
  for (const source of ['CustomMessage_AdminCreateUser', 'CustomMessage_UpdateUserAttribute', 'CustomMessage_Authentication']) {
    const out = await handler(cognitoEvent(source));
    assert.equal(out.response.emailMessage, null, source);
  }
});

test('erro na montagem: evento sem mudanca (o Cognito usa o texto padrao e o cadastro segue)', async () => {
  const logs = [];
  const broken = makeCustomMessageHandler({ appUrl: undefined, log: (...a) => logs.push(a) }).handler;
  const out = await broken(cognitoEvent('CustomMessage_SignUp'));
  assert.equal(out.response.emailMessage, null);
  assert.equal(logs.length, 1);
});
