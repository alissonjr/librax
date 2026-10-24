/**
 * Servidor local (`npm run local`), depois do `npm run local:up`:
 *
 * - http://127.0.0.1:5332/api/v1/...  a HTTP API das rotas do template, com o autorizador JWT
 *   (apiGateway.mjs) e as Lambdas montadas pelas fabricas (functions.mjs);
 * - http://127.0.0.1:5332/             proxy do cognito-idp para o Amplify (cognitoProxy.mjs);
 * - https://127.0.0.1:5333/            a pagina que imita o Hosted UI (hostedUi.mjs).
 *
 * Tudo em 127.0.0.1, sem chamada a AWS (awsGuard.mjs).
 */

import './awsGuard.mjs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { loadPlan, loadState } from './bootstrap.mjs';
import { makeLocalFunctions } from './functions.mjs';
import { makeCognitoLocal } from './cognitoLocal.mjs';
import { makeCognitoProxy } from './cognitoProxy.mjs';
import { makeHostedUi } from './hostedUi.mjs';
import { makeJwtVerifier } from './jwt.mjs';
import { makeApiGateway } from './apiGateway.mjs';
import { issuerFor } from './template.mjs';
import { HOST, PORTS, PATHS, URLS, ACCOUNTS } from './config.mjs';

const MAX_BODY = 11 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('corpo grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, { status, headers = {}, body = '' }) {
  res.writeHead(status, headers);
  res.end(body);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function startServer({ log = console.log, quiet = false } = {}) {
  if (!existsSync(PATHS.state) || !existsSync(PATHS.template)) {
    throw new Error('ambiente local sem bootstrap: rode `npm run local:up` antes');
  }
  for (const [name, port] of [['DynamoDB Local', PORTS.dynamodb], ['moto', PORTS.moto]]) {
    if (!(await portOpen(port))) throw new Error(`${name} fora do ar na porta ${port}: rode \`npm run local:up\``);
  }

  const plan = loadPlan();
  const state = loadState();
  const functions = makeLocalFunctions({ plan, state, log });
  const local = makeCognitoLocal({ state, plan, invoke: (name, event) => functions.invoke(name, event), log });
  const proxy = makeCognitoProxy({ local, log });
  const hostedUi = makeHostedUi({ local, proxy, state, log });
  const jwt = makeJwtVerifier({
    issuer: issuerFor(state.region, state.userPoolId),
    jwksUrl: `${URLS.moto}/${state.userPoolId}/.well-known/jwks.json`,
  });
  const gateway = makeApiGateway({ plan, state, handlers: functions.http, jwt, log });

  const apiServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORTS.api}`}`);
      const target = req.headers['x-amz-target'];
      // cognito-idp: o Amplify chama a raiz com X-Amz-Target (e o preflight do navegador antes)
      if (url.pathname === '/' && (target || req.method === 'OPTIONS')) {
        const cors = {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'x-amzn-RequestId,x-amzn-ErrorType,x-amzn-ErrorMessage,Date',
        };
        if (req.method === 'OPTIONS') {
          return send(res, {
            status: 204,
            headers: {
              ...cors,
              'Access-Control-Allow-Methods': 'POST',
              'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '*',
              'Access-Control-Max-Age': '3600',
            },
          });
        }
        const body = await readBody(req);
        const out = await proxy.handle(target, body.toString('utf8'));
        return send(res, { ...out, headers: { ...out.headers, ...cors } });
      }
      const body = await readBody(req);
      const out = await gateway.handle({
        method: req.method,
        url,
        headers: req.headers,
        body,
        sourceIp: req.socket.remoteAddress ?? HOST,
      });
      return send(res, out);
    } catch (err) {
      log('[local] erro', err);
      return send(res, { status: err.status ?? 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Internal Server Error' }) });
    }
  });

  const loginServer = https.createServer(
    { key: readFileSync(PATHS.tlsKey), cert: readFileSync(PATHS.tlsCert) },
    async (req, res) => {
      try {
        const url = new URL(req.url, URLS.login);
        const raw = req.method === 'POST' ? await readBody(req) : Buffer.alloc(0);
        const form = Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
        return send(res, await hostedUi.handle({ method: req.method, url, headers: req.headers, form }));
      } catch (err) {
        log('[login local] erro', err);
        return send(res, { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'erro no servidor local' });
      }
    },
  );

  await Promise.all([
    new Promise((resolve, reject) => apiServer.once('error', reject).listen(PORTS.api, HOST, resolve)),
    new Promise((resolve, reject) => loginServer.once('error', reject).listen(PORTS.login, HOST, resolve)),
  ]);

  if (!quiet) {
    const main = ACCOUNTS.filter((a) => a.role);
    log(`
Librax local no ar (nada vai para a AWS):
  API ............ ${URLS.api}/${plan.api.stage}/v1/...   (${plan.api.routes.length} rotas do template)
  Cognito (proxy)  ${URLS.api}/
  Login local .... ${URLS.login}/   (aceite o certificado uma vez)
  App ............ ${URLS.app}/        (cd apps/web-poc && npm run dev:local)
  Painel ......... ${URLS.admin}/admin/  (cd apps/admin-web && npm run dev:local)
Contas: ${main.map((a) => `${a.email} / ${a.password}`).join('  |  ')}
`);
  }

  return {
    plan,
    state,
    functions,
    local,
    async close() {
      const closed = Promise.all([
        new Promise((resolve) => apiServer.close(resolve)),
        new Promise((resolve) => loginServer.close(resolve)),
      ]);
      apiServer.closeAllConnections();
      loginServer.closeAllConnections();
      await closed;
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
    .then((server) => {
      const stop = () => server.close().then(() => process.exit(0));
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    })
    .catch((err) => {
      console.error(`[local] ${err.message}`);
      process.exit(1);
    });
}
