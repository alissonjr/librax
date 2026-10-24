import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeApiGateway } from '../local/apiGateway.mjs';

// Ambiente local: imitacao da HTTP API com as rotas e autorizadores do plano (template.mjs).
// O autorizador JWT e falso aqui (os testes dele estao em localAuth.test.js).

const plan = {
  api: {
    stage: 'api',
    cors: { AllowOrigins: ['http://127.0.0.1:5320'], AllowMethods: ['GET', 'POST'], AllowHeaders: ['Content-Type', 'Authorization'], MaxAge: 3600 },
    authorizers: {
      AppAuth: { identitySource: ['$request.header.Authorization'], audience: ['AppClient'] },
      AdminAuth: { identitySource: ['$request.header.Authorization'], audience: ['AdminClient'] },
    },
    routes: [
      { routeKey: 'GET /v1/squads/{squadId}', method: 'GET', path: '/v1/squads/{squadId}', handler: 'getSquad', functionName: 'f1', authorizationType: 'JWT', authorizer: 'AppAuth' },
      { routeKey: 'GET /v1/squads/public', method: 'GET', path: '/v1/squads/public', handler: 'listPublic', functionName: 'f2', authorizationType: 'JWT', authorizer: 'AppAuth' },
      { routeKey: 'GET /v1/admin/me', method: 'GET', path: '/v1/admin/me', handler: 'adminRouter', functionName: 'f3', authorizationType: 'JWT', authorizer: 'AdminAuth' },
    ],
  },
};
const state = { clients: { AppClient: { clientId: 'app-id' }, AdminClient: { clientId: 'admin-id' } } };

function gateway() {
  const events = [];
  const record = (name) => async (event) => {
    events.push({ name, event });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: name }) };
  };
  const jwt = {
    async check(header, audience) {
      const [, client, groups] = /^Bearer (\S+)(?: (\S+))?$/.exec(header ?? '') ?? [];
      if (!client || !audience.includes(client)) return { ok: false, reason: 'audiencia nao aceita' };
      return { ok: true, claims: { sub: 'u1', aud: client, ...(groups ? { 'cognito:groups': groups.split(',') } : {}) } };
    },
  };
  const gw = makeApiGateway({
    plan,
    state,
    handlers: { getSquad: record('getSquad'), listPublic: record('listPublic'), adminRouter: record('adminRouter') },
    jwt,
    log: () => {},
  });
  const call = (method, path, headers = {}, body = '') =>
    gw.handle({ method, url: new URL(`http://127.0.0.1:5332${path}`), headers, body: Buffer.from(body), sourceIp: '127.0.0.1' });
  return { call, events };
}

test('estagio no caminho, rota literal antes da com parametro e evento 2.0', async () => {
  const { call, events } = gateway();
  const auth = { authorization: 'Bearer app-id', origin: 'http://127.0.0.1:5320' };
  const res = await call('GET', '/api/v1/squads/public?x=1&x=2', auth);
  assert.equal(res.status, 200);
  assert.equal(events[0].name, 'listPublic');
  assert.equal(res.headers['Access-Control-Allow-Origin'], 'http://127.0.0.1:5320');

  await call('GET', '/api/v1/squads/abc%20d', auth);
  const ev = events[1].event;
  assert.equal(ev.version, '2.0');
  assert.equal(ev.routeKey, 'GET /v1/squads/{squadId}');
  assert.equal(ev.rawPath, '/api/v1/squads/abc%20d');
  assert.deepEqual(ev.pathParameters, { squadId: 'abc d' });
  assert.equal(ev.requestContext.stage, 'api');
  assert.equal(ev.requestContext.authorizer.jwt.claims.sub, 'u1');
  assert.equal(events[0].event.queryStringParameters.x, '1,2');

  assert.equal((await call('GET', '/v1/squads/public', auth)).status, 404);
  assert.equal((await call('POST', '/api/v1/squads/public', auth)).status, 404);
});

test('/v1/admin so com o token do client do painel; grupos como texto', async () => {
  const { call, events } = gateway();
  const denied = await call('GET', '/api/v1/admin/me', { authorization: 'Bearer app-id' });
  assert.equal(denied.status, 401);
  assert.deepEqual(JSON.parse(denied.body), { message: 'Unauthorized' });
  assert.equal(events.length, 0);

  const ok = await call('GET', '/api/v1/admin/me', { authorization: 'Bearer admin-id admin' });
  assert.equal(ok.status, 200);
  assert.equal(events[0].event.requestContext.authorizer.jwt.claims['cognito:groups'], '[admin]');
});

test('CORS: preflight so para as origens do template', async () => {
  const { call } = gateway();
  const ok = await call('OPTIONS', '/api/v1/squads/x', { origin: 'http://127.0.0.1:5320', 'access-control-request-method': 'GET' });
  assert.equal(ok.status, 204);
  assert.equal(ok.headers['Access-Control-Allow-Methods'], 'GET,POST');
  const other = await call('OPTIONS', '/api/v1/squads/x', { origin: 'https://outro.example', 'access-control-request-method': 'GET' });
  assert.equal(other.headers['Access-Control-Allow-Origin'], undefined);
});
