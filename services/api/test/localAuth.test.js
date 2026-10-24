import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import https from 'node:https';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeVerifier, startChallenge, verifyClaim, clientStart, clientSignature, newSecretBlock, nowString, padHex } from '../local/srp.mjs';
import { makeJwtVerifier, gatewayClaims } from '../local/jwt.mjs';
import { isBlockedHost, AwsBlockedError } from '../local/awsGuard.mjs';
import { makeCognitoLocal } from '../local/cognitoLocal.mjs';
import { makeCognitoProxy } from '../local/cognitoProxy.mjs';
import { makeHostedUi } from '../local/hostedUi.mjs';
import { makeSrpStore } from '../local/srpStore.mjs';
import { URLS } from '../local/config.mjs';

// Ambiente local: o SRP que o moto nao confere, o autorizador JWT com as regras do API Gateway,
// a trava que impede chamada a AWS de verdade, o "esqueci a senha" do proxy e da pagina local e a
// exclusao de conta pelo proxy do cognito-idp.
// Sem containers (onde precisa do moto, ele e de mentira, atras do fetch).

const POOL = 'us-east-1_abc123';
const USER = '11111111-1111-4111-8111-111111111111';

function srpLogin(verifier, salt, password) {
  const { a, A } = clientStart();
  const { B, state } = startChallenge({ verifier, A });
  const secretBlock = newSecretBlock();
  const timestamp = nowString(new Date('2026-10-23T22:16:05Z'));
  const claimSignature = clientSignature({ userPoolId: POOL, userId: USER, password, a, A, B, salt, secretBlock, timestamp });
  return verifyClaim({ userPoolId: POOL, userId: USER, verifier, state, secretBlock, timestamp, claimSignature });
}

test('SRP: so a senha certa passa no PASSWORD_VERIFIER', () => {
  const { salt, verifier } = makeVerifier({ userPoolId: POOL, userId: USER, password: 'senha-certa-1' });
  assert.equal(srpLogin(verifier, salt, 'senha-certa-1'), true);
  assert.equal(srpLogin(verifier, salt, 'senha-errada-1'), false);
});

test('SRP: hex com sinal como o getPaddedHex do Amplify e data como o getNowString', () => {
  assert.equal(padHex(20n), '14');
  assert.equal(padHex(236n), '00ec');
  assert.equal(padHex(0x123n), '0123');
  assert.equal(nowString(new Date('2026-10-03T04:05:06Z')), 'Sat Oct 3 04:05:06 UTC 2026');
  assert.throws(() => startChallenge({ verifier: 'ab', A: '0' }), /SRP_A/);
});

// --- JWT ---------------------------------------------------------------------

const ISSUER = `https://cognito-idp.us-east-1.amazonaws.com/${POOL}`;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const NOW = Date.parse('2026-10-23T15:00:00Z');

function sign(claims, { kid = 'k1', key = privateKey } = {}) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', kid })}.${enc(claims)}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(key).toString('base64url')}`;
}

function verifier() {
  const calls = [];
  const v = makeJwtVerifier({
    issuer: ISSUER,
    jwksUrl: 'http://127.0.0.1:5331/pool/.well-known/jwks.json',
    now: () => NOW,
    fetchImpl: async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ keys: [jwk] }) };
    },
  });
  return { v, calls };
}

const base = { iss: ISSUER, sub: USER, exp: NOW / 1000 + 600, token_use: 'id' };

test('JWT: id token do client certo passa; chaves vem do moto, nunca do iss', async () => {
  const { v, calls } = verifier();
  const r = await v.check(`Bearer ${sign({ ...base, aud: 'app' })}`, ['app']);
  assert.equal(r.ok, true);
  assert.equal(r.claims.sub, USER);
  assert.deepEqual(calls, ['http://127.0.0.1:5331/pool/.well-known/jwks.json']);
  // access token: sem aud, vale o client_id
  assert.equal((await v.check(sign({ ...base, client_id: 'app', token_use: 'access' }), ['app'])).ok, true);
});

test('JWT: outro client, emissor, validade, assinatura ou alg recusados', async () => {
  const { v } = verifier();
  const reason = async (token, aud = ['admin']) => (await v.check(`Bearer ${token}`, aud)).reason;
  assert.equal(await reason(sign({ ...base, aud: 'app' })), 'audiencia nao aceita');
  assert.equal(await reason(sign({ ...base, aud: 'admin', iss: 'https://cognito-idp.us-east-1.amazonaws.com/outro' })), 'emissor diferente');
  assert.equal(await reason(sign({ ...base, aud: 'admin', exp: NOW / 1000 - 1 })), 'expirado');
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  assert.equal(await reason(sign({ ...base, aud: 'admin' }, { key: other })), 'assinatura invalida');
  assert.equal(await reason(sign({ ...base, aud: 'admin' }, { kid: 'k2' })), 'kid desconhecido');
  const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(base)).toString('base64url')}.`;
  assert.equal(await reason(none), 'alg none');
  assert.equal(await reason(''), 'sem token');
});

test('claims como o API Gateway entrega: tudo texto, grupos como "[admin]"', () => {
  assert.deepEqual(gatewayClaims({ sub: 'x', exp: 10, email_verified: true, 'cognito:groups': ['admin'] }), {
    sub: 'x',
    exp: '10',
    email_verified: 'true',
    'cognito:groups': '[admin]',
  });
});

// --- Trava da AWS ---------------------------------------------------------------

test('trava: enderecos da AWS recusados, os locais nao', async () => {
  assert.equal(isBlockedHost('dynamodb.us-east-1.amazonaws.com'), true);
  assert.equal(isBlockedHost('cognito-idp.us-east-1.amazonaws.com:443'), true);
  assert.equal(isBlockedHost('librax-example.auth.us-east-1.amazoncognito.com'), true);
  assert.equal(isBlockedHost('127.0.0.1'), false);
  assert.equal(isBlockedHost('fcm.googleapis.com'), false);
  assert.throws(() => https.request('https://ce.us-east-1.amazonaws.com/'), AwsBlockedError);
  await assert.rejects(fetch('https://sts.amazonaws.com/'), AwsBlockedError);
  assert.equal(process.env.AWS_ACCESS_KEY_ID, 'local');
  assert.equal(process.env.AWS_ENDPOINT_URL_DYNAMODB, 'http://127.0.0.1:5330');
});

// --- Esqueci a senha (proxy do cognito-idp e pagina local) -------------------------

const APP_CALLBACK = 'http://127.0.0.1:5320/auth/callback';

/** moto de mentira atras do fetch: so o AdminGetUser e o AdminSetUserPassword da troca de senha. */
function fakeMoto(t, users) {
  const passwords = new Map();
  const guarded = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url) !== URLS.moto) return guarded(url, init);
    const target = init.headers['X-Amz-Target'].split('.').pop();
    const body = JSON.parse(init.body);
    const reply = (status, data) => new Response(JSON.stringify(data), { status });
    const user = users.find((u) => u.Username === String(body.Username).toLowerCase());
    if (!user) return reply(400, { __type: 'UserNotFoundException', message: 'User does not exist.' });
    if (target === 'AdminGetUser') return reply(200, user);
    if (target === 'AdminSetUserPassword') {
      passwords.set(user.Username, body.Password);
      return reply(200, {});
    }
    return reply(400, { __type: 'InvalidAction', message: target });
  });
  return passwords;
}

const motoUser = (email, sub, extra = {}, status = 'CONFIRMED') => ({
  Username: email,
  UserStatus: status,
  Enabled: true,
  UserAttributes: Object.entries({ sub, email, email_verified: 'true', ...extra }).map(([Name, Value]) => ({ Name, Value })),
});

function resetEnv(t) {
  const passwords = fakeMoto(t, [
    motoUser('ana@librax.example', USER),
    motoUser('gabi.google@librax.example', '22222222-2222-4222-8222-222222222222', { identities: '[{"providerName":"Google"}]' }),
    motoUser('novo@librax.example', '33333333-3333-4333-8333-333333333333', { email_verified: 'false' }, 'UNCONFIRMED'),
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'librax-srp-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const srpStore = makeSrpStore(join(dir, 'srp.json'));
  const state = {
    region: 'us-east-1',
    userPoolId: POOL,
    appClientId: 'app',
    clients: {
      app: {
        clientId: 'app',
        props: {
          PreventUserExistenceErrors: 'ENABLED',
          CallbackURLs: [APP_CALLBACK],
          AllowedOAuthFlows: ['code'],
          AllowedOAuthScopes: ['openid', 'email', 'profile'],
        },
      },
    },
  };
  const plan = { userPool: { props: { Policies: { PasswordPolicy: { MinimumLength: 8 } } }, postConfirmation: 'librax-post-confirmation' } };
  const triggers = [];
  const invoke = async (name, event) => {
    triggers.push(event.triggerSource);
    return event;
  };
  const local = makeCognitoLocal({ state, plan, invoke, srpStore, log: () => {} });
  const proxy = makeCognitoProxy({ local, log: () => {} });
  const call = async (target, body) => {
    const res = await proxy.handle(`AWSCognitoIdentityProviderService.${target}`, JSON.stringify({ ClientId: 'app', ...body }));
    return { status: res.status, body: JSON.parse(res.body) };
  };
  return { local, proxy, state, call, srpStore, passwords, triggers };
}

const otherCode = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

test('esqueci a senha: codigo na caixa simulada e a senha nova passa a valer no SRP', async (t) => {
  const env = resetEnv(t);
  env.srpStore.setPassword(POOL, USER, 'senha-velha-1');
  const Username = 'ana@librax.example';

  const sent = await env.call('ForgotPassword', { Username });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  assert.deepEqual(sent.body.CodeDeliveryDetails, { Destination: 'a***@l***', DeliveryMedium: 'EMAIL', AttributeName: 'email' });
  const mail = env.local.inbox[0];
  assert.equal(mail.to, Username);
  assert.equal(mail.purpose, 'nova senha');

  // codigo errado nao troca; senha fraca recusada pela politica do template sem gastar o codigo
  const wrong = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: otherCode(mail.code), Password: 'senha-nova-1' });
  assert.equal(wrong.body.__type, 'CodeMismatchException');
  const weak = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: mail.code, Password: 'curta' });
  assert.equal(weak.body.__type, 'InvalidPasswordException');
  assert.match(weak.body.message, /Password not long enough/);

  const ok = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: mail.code, Password: 'senha-nova-1' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const { salt, verifier } = env.srpStore.get(POOL, USER);
  assert.equal(srpLogin(verifier, salt, 'senha-nova-1'), true);
  assert.equal(srpLogin(verifier, salt, 'senha-velha-1'), false);
  assert.equal(env.passwords.get(Username), 'senha-nova-1');
  assert.deepEqual(env.triggers, ['PostConfirmation_ConfirmForgotPassword']);

  // o codigo e de uso unico
  const again = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: mail.code, Password: 'senha-nova-2' });
  assert.equal(again.body.__type, 'ExpiredCodeException');
});

test('esqueci a senha nao conta se a conta existe: sem conta, so do Google ou nao confirmada', async (t) => {
  const env = resetEnv(t);
  for (const Username of ['ninguem@librax.example', 'gabi.google@librax.example', 'novo@librax.example']) {
    const r = await env.call('ForgotPassword', { Username });
    assert.equal(r.status, 200, Username);
    assert.equal(r.body.CodeDeliveryDetails.DeliveryMedium, 'EMAIL');
  }
  assert.equal(env.local.inbox.length, 0, 'nenhum e-mail sai');
  const none = await env.call('ConfirmForgotPassword', { Username: 'ninguem@librax.example', ConfirmationCode: '123456', Password: 'senha-nova-1' });
  assert.equal(none.body.__type, 'CodeMismatchException');
});

test('esqueci a senha: limite de pedidos e de codigos errados (LimitExceededException)', async (t) => {
  const env = resetEnv(t);
  const Username = 'ana@librax.example';
  for (let i = 0; i < 5; i++) assert.equal((await env.call('ForgotPassword', { Username })).status, 200);
  assert.equal((await env.call('ForgotPassword', { Username })).body.__type, 'LimitExceededException');

  const { code } = env.local.inbox[0];
  for (let i = 0; i < 5; i++) {
    const r = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: otherCode(code), Password: 'senha-nova-1' });
    assert.equal(r.body.__type, 'CodeMismatchException');
  }
  // depois de 5 codigos errados nem o certo passa
  const blocked = await env.call('ConfirmForgotPassword', { Username, ConfirmationCode: code, Password: 'senha-nova-1' });
  assert.equal(blocked.body.__type, 'LimitExceededException');
});

test('pagina local: "Esqueci a senha" mostra o codigo e volta ao login com o e-mail', async (t) => {
  const env = resetEnv(t);
  const ui = makeHostedUi({ local: env.local, proxy: env.proxy, state: env.state, log: () => {} });
  const page = (method, path, form = {}) => ui.handle({ method, url: new URL(path, URLS.login), headers: {}, form });

  const query = new URLSearchParams({ response_type: 'code', client_id: 'app', redirect_uri: APP_CALLBACK, scope: 'openid email' });
  const login = await page('GET', `/oauth2/authorize?${query}`);
  const tx = /name="tx" value="([^"]+)"/.exec(login.body)?.[1];
  assert.ok(tx, login.body.slice(0, 300));
  assert.ok(login.body.includes(`href="/forgot?tx=${tx}">Esqueci a senha`));
  assert.equal((await page('GET', `/forgot?tx=${tx}`)).status, 200);

  // conta so do Google: mesma tela, sem codigo
  const google = await page('POST', '/forgot', { tx, email: 'gabi.google@librax.example' });
  assert.equal(google.status, 200);
  assert.doesNotMatch(google.body, /o código é/);

  const sent = await page('POST', '/forgot', { tx, email: 'Ana@librax.example' });
  const code = /o código é <strong>(\d{6})<\/strong>/.exec(sent.body)?.[1];
  assert.equal(code, env.local.inbox[0].code);

  const weak = await page('POST', '/reset', { tx, code, password: 'curta' });
  assert.equal(weak.status, 400);
  assert.match(weak.body, /Senha fraca/);

  const done = await page('POST', '/reset', { tx, code, password: 'senha-nova-1' });
  assert.equal(done.status, 200);
  assert.match(done.body, /Senha alterada\. Entre com a senha nova\./);
  assert.match(done.body, /value="ana@librax\.example"/);
  assert.equal(env.passwords.get('ana@librax.example'), 'senha-nova-1');
});

// --- Exclusao de conta pelo proxy do cognito-idp -----------------------------------

test('proxy: AdminDeleteUser apaga no moto e o verificador SRP; depois a conta nao entra mais', async () => {
  const pool = 'us-east-1_local';
  const sub = '22222222-2222-4222-8222-222222222222';
  const srpStore = makeSrpStore(join(mkdtempSync(join(tmpdir(), 'librax-srp-')), 'srp.json'));
  srpStore.setPassword(pool, sub, 'senha-certa-1');

  // moto falso: um usuario, que some no AdminDeleteUser
  let exists = true;
  const targets = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const target = init.headers['X-Amz-Target'].split('.').pop();
    targets.push(target);
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/x-amz-json-1.1' } });
    if (!exists) return reply(400, { __type: 'UserNotFoundException', message: 'User does not exist.' });
    if (target === 'AdminGetUser') return reply(200, { Username: sub, UserStatus: 'CONFIRMED', UserAttributes: [{ Name: 'sub', Value: sub }] });
    if (target === 'AdminDeleteUser') {
      exists = false;
      return reply(200, {});
    }
    return reply(200, { AuthenticationResult: { IdToken: 'x' } });
  };

  try {
    const local = makeCognitoLocal({
      state: {
        userPoolId: pool,
        region: 'us-east-1',
        clients: { app: { clientId: 'app', props: { PreventUserExistenceErrors: 'ENABLED', ExplicitAuthFlows: ['ALLOW_USER_SRP_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'] } } },
      },
      plan: { userPool: { postConfirmation: null } },
      invoke: async () => {},
      srpStore,
      log: () => {},
    });
    const proxy = makeCognitoProxy({ local, log: () => {} });
    const call = async (target, body) => {
      const res = await proxy.handle(`AWSCognitoIdentityProviderService.${target}`, JSON.stringify(body));
      return { status: res.status, type: res.headers['x-amzn-ErrorType'] ?? null };
    };

    assert.deepEqual(await call('AdminDeleteUser', { UserPoolId: pool, Username: sub }), { status: 200, type: null });
    assert.equal(srpStore.get(pool, sub), null);
    assert.deepEqual(targets, ['AdminGetUser', 'AdminDeleteUser']);

    // de novo: UserNotFoundException (a Lambda trata como ja apagado)
    assert.equal((await call('AdminDeleteUser', { UserPoolId: pool, Username: sub })).type, 'UserNotFoundException');
    // login por SRP e refresh da sessao antiga: NotAuthorizedException, como no Cognito
    assert.equal((await call('InitiateAuth', { AuthFlow: 'USER_SRP_AUTH', ClientId: 'app', AuthParameters: { USERNAME: 'ana@x.com', SRP_A: 'ab' } })).type, 'NotAuthorizedException');
    assert.equal((await call('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: 'app', AuthParameters: { REFRESH_TOKEN: 'r' } })).type, 'NotAuthorizedException');
  } finally {
    globalThis.fetch = realFetch;
  }
});
