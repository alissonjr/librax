import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeHostedUi } from '../local/hostedUi.mjs';
import { URLS } from '../local/config.mjs';

// Pagina local que imita o Hosted UI do Cognito: o cadastro e o Google (simulado) repetem a frase
// de aceite do app, com links para os Termos e a Politica do app local. Sem moto e sem containers.

const CALLBACK = `${URLS.app}/auth/callback`;

function hostedUi() {
  const client = {
    props: {
      CallbackURLs: [CALLBACK],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthScopes: ['openid', 'email', 'profile'],
      SupportedIdentityProviders: ['COGNITO', 'Google'],
    },
  };
  const local = { clientsById: new Map([['app-client', client]]), inbox: [] };
  return makeHostedUi({ local, proxy: {}, state: { appClientId: 'app-client' }, log: () => {} });
}

function authorizeUrl(extra = {}) {
  const url = new URL(`${URLS.login}/oauth2/authorize`);
  const params = {
    client_id: 'app-client',
    redirect_uri: CALLBACK,
    response_type: 'code',
    scope: 'openid email',
    code_challenge: 'abc',
    code_challenge_method: 'S256',
    ...extra,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

const get = (ui, url) => ui.handle({ method: 'GET', url, headers: {}, form: {} });

const TERMS = `href="${URLS.app}/termos"`;
const PRIVACY = `href="${URLS.app}/privacidade"`;

test('cadastro local: "Ao criar a conta" com links para /termos e /privacidade do app', async () => {
  const ui = hostedUi();
  const login = await get(ui, authorizeUrl());
  assert.equal(login.status, 200);
  const tx = /\/signup\?tx=([\w-]+)/.exec(login.body)?.[1];
  assert.ok(tx, 'a tela de login leva ao cadastro');

  const signup = await get(ui, new URL(`${URLS.login}/signup?tx=${tx}`));
  assert.equal(signup.status, 200);
  assert.match(signup.body, /Ao criar a conta, você concorda com os <a [^>]+>Termos de Uso<\/a> e a <a [^>]+>Política de Privacidade<\/a>\./);
  assert.ok(signup.body.includes(TERMS));
  assert.ok(signup.body.includes(PRIVACY));
});

test('Google (simulado): a primeira entrada cria a conta, então mostra a mesma frase', async () => {
  const ui = hostedUi();
  const google = await get(ui, authorizeUrl({ identity_provider: 'Google' }));
  assert.equal(google.status, 200);
  assert.match(google.body, /Ao continuar, você concorda com os/);
  assert.ok(google.body.includes(TERMS));
  assert.ok(google.body.includes(PRIVACY));
});
