/**
 * Teste de ponta a ponta do ambiente local (docs/ambiente-local.md). Fora do `npm test`: precisa
 * dos containers e do bootstrap (`npm run local:up`). Rodar com `npm run test:e2e`.
 *
 * Usa o servidor local ja no ar (`npm run local`) ou sobe um no proprio processo.
 *
 * 1. Login pela pagina local com PKCE (authorize, formulario, code, token), como o app faz.
 * 2. Conclui uma licao pela API e confere o progresso direto no DynamoDB Local.
 * 3. /v1/admin com a conta admin (200) e com a comum (403); o token do app nao abre (401).
 * 4. Login por SRP pelo proxy do cognito-idp: senha certa entra, errada nao.
 * 5. Exclusao de conta (DELETE /v1/users/me) de uma conta nova de e-mail e senha e de uma do
 *    Google simulado: some do banco e do Cognito, e a conta nao entra mais. As contas de teste
 *    da semente nao sao tocadas.
 */

import '../local/awsGuard.mjs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PATHS, URLS, PORTS, HOST, REGION, ACCOUNTS } from '../local/config.mjs';
import { clientStart, clientSignature, nowString } from '../local/srp.mjs';
import catalog from '../src/content/catalog.js';

const aluno = ACCOUNTS.find((a) => a.role === 'aluno');
const admin = ACCOUNTS.find((a) => a.role === 'admin');
const APP_CALLBACK = `${URLS.app}/auth/callback`;
const ADMIN_CALLBACK = `${URLS.admin}/admin/auth/callback`;

let state;
let server = null;
const ca = () => readFileSync(PATHS.tlsCert);

/** Pedido HTTP(S) cru (sem seguir redirecionamento), confiando no certificado local. */
function request(url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(u, { method, headers, ...(u.protocol === 'https:' ? { ca: ca() } : {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const form = (data) => new URLSearchParams(data).toString();
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: HOST, port }, () => {
      s.end();
      resolve(true);
    });
    s.on('error', () => resolve(false));
  });
}

/** Authorize com PKCE S256 ate a pagina (login ou Google simulado) com a transacao. */
async function authorizeFlow({ clientId, redirectUri, identityProvider = null }) {
  const verifier = randomBytes(48).toString('base64url');
  const stateParam = randomBytes(8).toString('hex');
  const authorize = new URL(`${URLS.login}/oauth2/authorize`);
  authorize.search = form({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    state: stateParam,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    ...(identityProvider ? { identity_provider: identityProvider } : {}),
  });
  const page = await request(authorize.toString());
  assert.equal(page.status, 200, 'pagina de login');
  const tx = /name="tx" value="([^"]+)"/.exec(page.text)?.[1];
  assert.ok(tx, 'pagina de login sem transacao');
  return { authorize, tx, verifier, stateParam, clientId, redirectUri };
}

/** Authorize, formulario de login e volta com o code (PKCE S256), como o app e o painel fazem. */
async function hostedLogin({ clientId, redirectUri, email, password }) {
  const flow = await authorizeFlow({ clientId, redirectUri });
  const login = await request(`${URLS.login}/login`, { method: 'POST', headers: FORM, body: form({ tx: flow.tx, email, password }) });
  return { ...flow, login };
}

/** Troca o code pelos tokens no /oauth2/token. */
function exchange({ login, clientId, redirectUri }, verifier) {
  const code = new URL(login.headers.location).searchParams.get('code');
  return request(`${URLS.login}/oauth2/token`, {
    method: 'POST',
    headers: FORM,
    body: form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }),
  });
}

async function loginTokens(opts) {
  const flow = await hostedLogin(opts);
  assert.equal(flow.login.status, 302, `login de ${opts.email}: ${flow.login.text.slice(0, 200)}`);
  const res = await exchange(flow, flow.verifier);
  assert.equal(res.status, 200, `token: ${res.text}`);
  return res.json();
}

const api = (path, { token, method = 'GET', body } = {}) =>
  request(`${URLS.api}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

const claimsOf = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'));

/** cognito-idp pelo proxy do servidor local (o mesmo endpoint que o Amplify do app usa). */
async function cognitoCall(target, body) {
  const res = await request(`${URLS.api}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: res.json() };
}

before(async () => {
  for (const [name, port] of [['DynamoDB Local', PORTS.dynamodb], ['moto', PORTS.moto]]) {
    if (!(await portOpen(port))) throw new Error(`${name} fora do ar (porta ${port}): rode \`npm run local:up\``);
  }
  state = JSON.parse(readFileSync(PATHS.state, 'utf8'));
  if (!(await portOpen(PORTS.api))) {
    const { startServer } = await import('../local/server.mjs');
    server = await startServer({ log: () => {}, quiet: true });
  }
});

after(async () => {
  await server?.close();
});

test('login pela pagina local com PKCE: code so troca com o verifier certo', async () => {
  const opts = { clientId: state.appClientId, redirectUri: APP_CALLBACK, email: aluno.email, password: aluno.password };
  const flow = await hostedLogin(opts);
  assert.equal(flow.login.status, 302, flow.login.text.slice(0, 200));
  const back = new URL(flow.login.headers.location);
  assert.equal(`${back.origin}${back.pathname}`, APP_CALLBACK);
  assert.equal(back.searchParams.get('state'), flow.stateParam);

  // verifier errado nao troca o code, e o code nao serve de novo
  assert.equal((await exchange(flow, 'x'.repeat(48))).status, 400);
  assert.equal((await exchange(flow, flow.verifier)).status, 400);

  // fluxo inteiro de novo, agora com o verifier certo
  const fresh = await hostedLogin(opts);
  const tokens = await exchange(fresh, fresh.verifier);
  assert.equal(tokens.status, 200, tokens.text);
  const claims = claimsOf(tokens.json().id_token);
  assert.equal(claims.aud, state.appClientId);
  assert.equal(claims.email, aluno.email);
  assert.equal(claims.iss, `https://cognito-idp.us-east-1.amazonaws.com/${state.userPoolId}`);

  // senha errada fica na pagina, sem code
  const wrong = await hostedLogin({ ...opts, password: 'senha-errada-1' });
  assert.equal(wrong.login.status, 400);
  assert.match(wrong.login.text, /E-mail ou senha incorretos/);

  // transacao inexistente e callback fora da lista do client: pagina de erro, sem redirecionar
  const bad = await request(`${URLS.login}/login`, { method: 'POST', headers: FORM, body: form({ tx: 'inexistente', email: aluno.email, password: 'x' }) });
  assert.equal(bad.status, 400);
  const evil = new URL(flow.authorize);
  evil.searchParams.set('redirect_uri', 'https://atacante.example/cb');
  assert.equal((await request(evil.toString())).status, 400);
});

test('conclui uma licao pela API e o progresso aparece no banco', async () => {
  const tokens = await loginTokens({ clientId: state.appClientId, redirectUri: APP_CALLBACK, email: aluno.email, password: aluno.password });
  const { sub } = claimsOf(tokens.id_token);

  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: URLS.dynamodb, region: REGION }));
  const profileBefore = (await db.send(new GetCommand({ TableName: 'librax', Key: { PK: `USER#${sub}`, SK: 'PROFILE' } }))).Item;

  const lessonAttemptId = `e2e-${randomUUID()}`;
  const today = new Date().toISOString().slice(0, 10);
  const res = await api('/v1/lesson/complete', {
    token: tokens.id_token,
    method: 'POST',
    body: { lessonAttemptId, lessonId: 'u1-l1', today, score: 1, reviewed: [{ signId: 'letra-A', result: { state: 'correct' } }] },
  });
  assert.equal(res.status, 200, res.text);
  const result = res.json();
  assert.equal(result.duplicate, false);
  assert.equal(result.xpAwarded, catalog.lessons['u1-l1'].xpReward);

  const attempt = (await db.send(new GetCommand({ TableName: 'librax', Key: { PK: `USER#${sub}`, SK: `ATTEMPT#${lessonAttemptId}` } }))).Item;
  assert.equal(attempt?.status, 'done');
  const profile = (await db.send(new GetCommand({ TableName: 'librax', Key: { PK: `USER#${sub}`, SK: 'PROFILE' } }))).Item;
  assert.equal(profile.xpTotal, (profileBefore?.xpTotal ?? 0) + catalog.lessons['u1-l1'].xpReward);
  assert.equal(profile.lastActiveDay, today);

  // reenvio da mesma tentativa nao soma de novo
  const again = await api('/v1/lesson/complete', { token: tokens.id_token, method: 'POST', body: { lessonAttemptId, lessonId: 'u1-l1', today, score: 1 } });
  assert.equal(again.json().duplicate, true);

  // sem token e token adulterado: 401 do autorizador, sem chegar na Lambda
  assert.equal((await api('/v1/lesson/queue')).status, 401);
  const [h, p] = tokens.id_token.split('.');
  assert.equal((await api('/v1/lesson/queue', { token: `${h}.${p}.assinatura` })).status, 401);
});

test('/v1/admin: 200 para a conta admin, 403 para a comum e 401 para o token do app', async () => {
  const adminTokens = await loginTokens({ clientId: state.adminClientId, redirectUri: ADMIN_CALLBACK, email: admin.email, password: admin.password });
  const me = await api('/v1/admin/me', { token: adminTokens.id_token });
  assert.equal(me.status, 200, me.text);
  assert.deepEqual(me.json().groups, ['admin']);
  const overview = await api('/v1/admin/overview', { token: adminTokens.id_token });
  assert.equal(overview.status, 200);
  const search = await api(`/v1/admin/accounts?q=${encodeURIComponent('aluno@')}`, { token: adminTokens.id_token });
  assert.equal(search.status, 200);
  assert.equal(search.json().accounts[0]?.email, aluno.email);

  const commonTokens = await loginTokens({ clientId: state.adminClientId, redirectUri: ADMIN_CALLBACK, email: aluno.email, password: aluno.password });
  const denied = await api('/v1/admin/me', { token: commonTokens.id_token });
  assert.equal(denied.status, 403);
  assert.equal(denied.json().error.code, 'ADMIN_ONLY');

  // o autorizador do painel so aceita o client do painel, mesmo para quem e admin
  const appTokens = await loginTokens({ clientId: state.appClientId, redirectUri: APP_CALLBACK, email: admin.email, password: admin.password });
  assert.equal((await api('/v1/admin/me', { token: appTokens.id_token })).status, 401);
});

test('login por SRP pelo proxy do cognito-idp: senha certa entra, errada nao', async () => {
  const call = async (target, body) => {
    const res = await request(`${URLS.api}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: res.json() };
  };
  const attempt = async (password) => {
    const { a, A } = clientStart();
    const init = await call('InitiateAuth', { AuthFlow: 'USER_SRP_AUTH', ClientId: state.appClientId, AuthParameters: { USERNAME: aluno.email, SRP_A: A } });
    assert.equal(init.status, 200, JSON.stringify(init.body));
    const p = init.body.ChallengeParameters;
    const timestamp = nowString();
    const signature = clientSignature({
      userPoolId: state.userPoolId, userId: p.USER_ID_FOR_SRP, password, a, A, B: p.SRP_B, salt: p.SALT, secretBlock: p.SECRET_BLOCK, timestamp,
    });
    return call('RespondToAuthChallenge', {
      ChallengeName: 'PASSWORD_VERIFIER',
      ClientId: state.appClientId,
      Session: init.body.Session,
      ChallengeResponses: { USERNAME: p.USER_ID_FOR_SRP, PASSWORD_CLAIM_SECRET_BLOCK: p.SECRET_BLOCK, TIMESTAMP: timestamp, PASSWORD_CLAIM_SIGNATURE: signature },
    });
  };

  const ok = await attempt(aluno.password);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.body.AuthenticationResult.IdToken);

  const wrong = await attempt('senha-errada-123');
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.__type, 'NotAuthorizedException');

  // o client do app nao libera USER_PASSWORD_AUTH (ExplicitAuthFlows do template)
  const plain = await call('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: state.appClientId, AuthParameters: { USERNAME: aluno.email, PASSWORD: aluno.password } });
  assert.equal(plain.body.__type, 'InvalidParameterException');
});

/** Itens que ainda guardam a conta: a particao USER#<id> e os membros de liga (GSI2). */
async function leftovers(db, sub) {
  const own = await db.send(new QueryCommand({ TableName: 'librax', KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': `USER#${sub}` } }));
  const leagues = await db.send(new QueryCommand({
    TableName: 'librax', IndexName: 'GSI2', KeyConditionExpression: 'GSI2PK = :pk', ExpressionAttributeValues: { ':pk': `USER#${sub}` },
  }));
  return [...(own.Items ?? []), ...(leagues.Items ?? [])].map((i) => `${i.PK} ${i.SK}`);
}

/** Conclui uma licao e cria uma squad so da pessoa (dissolve na exclusao). */
async function giveProgress(token) {
  const today = new Date().toISOString().slice(0, 10);
  const lesson = await api('/v1/lesson/complete', {
    token, method: 'POST', body: { lessonAttemptId: `e2e-${randomUUID()}`, lessonId: 'u1-l1', today, score: 1 },
  });
  assert.equal(lesson.status, 200, lesson.text);
  const squad = await api('/v1/squads', { token, method: 'POST', body: { name: 'Squad do e2e', type: 'private' } });
  assert.equal(squad.status, 201, squad.text);
  return squad.json().squadId;
}

test('exclusao de conta (e-mail e senha): some do banco e do Cognito, e a conta nao entra mais', async () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: URLS.dynamodb, region: REGION }));
  const email = `e2e-${randomUUID().slice(0, 8)}@librax.example`;
  const password = 'e2e-local-123';

  // cadastro pela pagina local: a caixa de e-mails simulada mostra o codigo na propria pagina
  const flow = await authorizeFlow({ clientId: state.appClientId, redirectUri: APP_CALLBACK });
  const signup = await request(`${URLS.login}/signup`, { method: 'POST', headers: FORM, body: form({ tx: flow.tx, email, name: 'E2E', password }) });
  const code = /o código é <strong>(\d{6})<\/strong>/.exec(signup.text)?.[1];
  assert.ok(code, `cadastro sem codigo: ${signup.text.slice(0, 200)}`);
  const login = await request(`${URLS.login}/confirm`, { method: 'POST', headers: FORM, body: form({ tx: flow.tx, code }) });
  assert.equal(login.status, 302, login.text.slice(0, 200));
  const tokens = (await exchange({ ...flow, login }, flow.verifier)).json();
  const { sub } = claimsOf(tokens.id_token);

  const squadId = await giveProgress(tokens.id_token);
  assert.ok((await leftovers(db, sub)).length > 0);

  const res = await api('/v1/users/me', { token: tokens.id_token, method: 'DELETE' });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json(), { ok: true });
  assert.deepEqual(await leftovers(db, sub), []);
  assert.equal((await db.send(new GetCommand({ TableName: 'librax', Key: { PK: `SQUAD#${squadId}`, SK: 'META' } }))).Item, undefined);

  // Cognito: o usuario nao existe mais, a senha nao entra e a sessao antiga nao renova
  assert.equal((await cognitoCall('AdminGetUser', { UserPoolId: state.userPoolId, Username: sub })).body.__type, 'UserNotFoundException');
  const again = await hostedLogin({ clientId: state.appClientId, redirectUri: APP_CALLBACK, email, password });
  assert.equal(again.login.status, 400);
  const { A } = clientStart();
  const srp = await cognitoCall('InitiateAuth', { AuthFlow: 'USER_SRP_AUTH', ClientId: state.appClientId, AuthParameters: { USERNAME: email, SRP_A: A } });
  assert.equal(srp.body.__type, 'NotAuthorizedException');
  const refresh = await request(`${URLS.login}/oauth2/token`, {
    method: 'POST', headers: FORM, body: form({ grant_type: 'refresh_token', client_id: state.appClientId, refresh_token: tokens.refresh_token }),
  });
  assert.equal(refresh.status, 400);
  const proxyRefresh = await cognitoCall('InitiateAuth', { AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: state.appClientId, AuthParameters: { REFRESH_TOKEN: tokens.refresh_token } });
  assert.equal(proxyRefresh.body.__type, 'NotAuthorizedException');

  // o id token ainda vale ate expirar (como no API Gateway): repetir a exclusao responde 200
  assert.equal((await api('/v1/users/me', { token: tokens.id_token, method: 'DELETE' })).status, 200);
});

test('exclusao de conta do Google simulado: apaga pelo cognito:username do token', async () => {
  const db = DynamoDBDocumentClient.from(new DynamoDBClient({ endpoint: URLS.dynamodb, region: REGION }));
  const email = `e2e-google-${randomUUID().slice(0, 8)}@librax.example`;
  const flow = await authorizeFlow({ clientId: state.appClientId, redirectUri: APP_CALLBACK, identityProvider: 'Google' });
  const login = await request(`${URLS.login}/google`, { method: 'POST', headers: FORM, body: form({ tx: flow.tx, email, name: 'Gabi' }) });
  assert.equal(login.status, 302, login.text.slice(0, 200));
  const tokens = (await exchange({ ...flow, login }, flow.verifier)).json();
  const claims = claimsOf(tokens.id_token);
  assert.ok(claims['cognito:username']);

  await giveProgress(tokens.id_token);
  assert.equal((await api('/v1/users/me', { token: tokens.id_token, method: 'DELETE' })).status, 200);
  assert.deepEqual(await leftovers(db, claims.sub), []);
  const found = await cognitoCall('ListUsers', { UserPoolId: state.userPoolId, Filter: `email = "${email}"` });
  assert.deepEqual(found.body.Users, []);
});
