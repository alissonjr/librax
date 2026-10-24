import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import https from 'node:https';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeVerifier, startChallenge, verifyClaim, clientStart, clientSignature, newSecretBlock, nowString, padHex } from '../local/srp.mjs';
import { makeJwtVerifier, gatewayClaims } from '../local/jwt.mjs';
import { isBlockedHost, AwsBlockedError } from '../local/awsGuard.mjs';
import { makeSrpStore } from '../local/srpStore.mjs';
import { makeCognitoLocal } from '../local/cognitoLocal.mjs';
import { makeCognitoProxy } from '../local/cognitoProxy.mjs';

// Ambiente local: o SRP que o moto nao confere, o autorizador JWT com as regras do API Gateway,
// a exclusao de conta pelo proxy do cognito-idp e a trava que impede chamada a AWS de verdade.
// Sem containers (o moto e um fetch falso).

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
