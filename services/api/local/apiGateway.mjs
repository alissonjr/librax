/**
 * Imitacao local da HTTP API (API Gateway v2) para as rotas do template:
 * - estagio no caminho (/api/v1/...), como o CloudFront repassa;
 * - escolha da rota pelo routeKey ("METODO /caminho/{param}"), a mais especifica primeiro;
 * - autorizador JWT de cada rota (jwt.mjs), 401 {"message":"Unauthorized"} como a AWS;
 * - CORS do template (preflight e Access-Control-Allow-Origin);
 * - evento no payload 2.0 e resposta da Lambda de volta para HTTP.
 */

import { randomUUID } from 'node:crypto';
import { gatewayClaims } from './jwt.mjs';
import { ACCOUNT_ID } from './config.mjs';

/** Corpo maximo da HTTP API. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

function compileRoute(route) {
  const segments = route.path.split('/').filter(Boolean);
  const names = [];
  const pattern = segments
    .map((seg) => {
      const m = /^\{(\w+)\}$/.exec(seg);
      if (!m) return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      names.push(m[1]);
      return '([^/]+)';
    })
    .join('/');
  return {
    ...route,
    regex: new RegExp(`^/${pattern}/?$`),
    names,
    literals: segments.filter((s) => !s.startsWith('{')).length,
  };
}

const TEXT_TYPES = /^(application\/(json|x-www-form-urlencoded|xml|javascript)|text\/)/i;

/** Evento do API Gateway HTTP API (payload 2.0). */
export function buildEvent({ route, stage, method, url, headers, body, params, claims, sourceIp, now = new Date() }) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : String(v)]),
  );
  const query = {};
  for (const [k, v] of url.searchParams) query[k] = k in query ? `${query[k]},${v}` : v;
  const contentType = lower['content-type'] ?? '';
  const binary = body.length > 0 && contentType && !TEXT_TYPES.test(contentType);
  const event = {
    version: '2.0',
    routeKey: route.routeKey,
    rawPath: url.pathname,
    rawQueryString: url.search.replace(/^\?/, ''),
    headers: lower,
    requestContext: {
      accountId: ACCOUNT_ID,
      apiId: 'librax-local-api',
      domainName: url.host,
      domainPrefix: url.hostname.split('.')[0],
      http: { method, path: url.pathname, protocol: 'HTTP/1.1', sourceIp, userAgent: lower['user-agent'] ?? '' },
      requestId: randomUUID(),
      routeKey: route.routeKey,
      stage,
      time: now.toUTCString(),
      timeEpoch: now.getTime(),
      ...(claims ? { authorizer: { jwt: { claims: gatewayClaims(claims), scopes: null } } } : {}),
    },
    isBase64Encoded: Boolean(binary),
  };
  if (lower.cookie) event.cookies = lower.cookie.split(/;\s*/);
  if (Object.keys(query).length) event.queryStringParameters = query;
  if (Object.keys(params).length) event.pathParameters = params;
  if (body.length) event.body = binary ? body.toString('base64') : body.toString('utf8');
  return event;
}

/**
 * @param {object} deps
 * @param {object} deps.plan         plano do template
 * @param {object} deps.state        ids do bootstrap (clients por logical id)
 * @param {object} deps.handlers     handlers HTTP pelo nome exportado
 * @param {{check: Function}} deps.jwt
 */
export function makeApiGateway({ plan, state, handlers, jwt, log = console.log }) {
  const stage = plan.api.stage;
  const routes = plan.api.routes.map(compileRoute).sort((a, b) => b.literals - a.literals);
  const cors = plan.api.cors;
  const audiences = Object.fromEntries(
    Object.entries(plan.api.authorizers).map(([id, a]) => [id, a.audience.map((logicalId) => state.clients[logicalId].clientId)]),
  );

  function corsHeaders(origin) {
    if (!cors || !origin || !(cors.AllowOrigins ?? []).includes(origin)) return {};
    return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }

  /** Rota do metodo e caminho (metodo errado tambem e 404 na HTTP API). */
  function match(method, path) {
    for (const route of routes) {
      const m = route.regex.exec(path);
      if (!m || (route.method !== method && route.method !== 'ANY')) continue;
      const params = Object.fromEntries(route.names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
      return { route, params };
    }
    return { route: null };
  }

  /**
   * @param {{method: string, url: URL, headers: object, body: Buffer, sourceIp: string}} req
   * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
   */
  async function handle({ method, url, headers, body, sourceIp }) {
    const origin = headers.origin;
    const json = (status, data, extra = {}) => ({
      status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extra },
      body: JSON.stringify(data),
    });

    const prefix = `/${stage}`;
    if (!url.pathname.startsWith(`${prefix}/`)) return json(404, { message: 'Not Found' });
    const path = url.pathname.slice(prefix.length);

    if (method === 'OPTIONS' && headers['access-control-request-method'] && cors) {
      const allowed = corsHeaders(origin);
      if (!allowed['Access-Control-Allow-Origin']) return { status: 204, headers: {}, body: '' };
      return {
        status: 204,
        headers: {
          ...allowed,
          'Access-Control-Allow-Methods': (cors.AllowMethods ?? []).join(','),
          'Access-Control-Allow-Headers': (cors.AllowHeaders ?? []).join(','),
          'Access-Control-Max-Age': String(cors.MaxAge ?? 0),
        },
        body: '',
      };
    }

    if (body.length > MAX_BODY_BYTES) return json(413, { message: 'Request Entity Too Large' });
    const { route, params } = match(method, path);
    if (!route) return json(404, { message: 'Not Found' });

    let claims = null;
    if (route.authorizationType === 'JWT') {
      const authorizer = plan.api.authorizers[route.authorizer];
      const source = authorizer.identitySource[0].replace('$request.header.', '').toLowerCase();
      const result = await jwt.check(headers[source], audiences[route.authorizer]);
      if (!result.ok) {
        log(`[api] 401 ${route.routeKey}: ${result.reason}`);
        return json(401, { message: 'Unauthorized' }, { 'www-authenticate': 'Bearer' });
      }
      claims = result.claims;
    }

    const handler = handlers[route.handler];
    const event = buildEvent({ route, stage, method, url, headers, body, params, claims, sourceIp });
    const started = Date.now();
    let res;
    try {
      res = await handler(event);
    } catch (err) {
      log(`[api] erro nao tratado em ${route.handler}`, err);
      return json(500, { message: 'Internal Server Error' });
    }
    log(`[api] ${method} ${url.pathname} -> ${res?.statusCode ?? 200} (${route.functionName}, ${Date.now() - started} ms)`);

    // Lambda devolvendo objeto sem statusCode: o API Gateway serializa como 200 JSON
    if (!res || typeof res !== 'object' || !('statusCode' in res)) return json(200, res ?? null);
    const out = res.isBase64Encoded ? Buffer.from(res.body ?? '', 'base64') : res.body ?? '';
    return {
      status: res.statusCode,
      headers: { ...(res.headers ?? {}), ...corsHeaders(origin), ...(res.cookies ? { 'Set-Cookie': res.cookies } : {}) },
      body: out,
    };
  }

  return { handle, routes };
}
