/**
 * Autorizador JWT local, com as regras do autorizador JWT do API Gateway HTTP API:
 * - token no cabecalho da identitySource (Authorization), com ou sem "Bearer ";
 * - RS256 com a chave do JWKS do emissor (`kid`), `iss` igual ao configurado, `exp` no futuro e
 *   `nbf` no passado;
 * - `aud` (id token) ou, sem ela, `client_id` (access token) dentro da audiencia configurada.
 *
 * O `iss` dos tokens do moto e o endereco real (https://cognito-idp.us-east-1.amazonaws.com/
 * <pool>), como na AWS: o autorizador so compara o texto e busca as chaves no moto
 * (`jwksUrl`), nunca no endereco do `iss`.
 */

import { createPublicKey, verify as verifySignature } from 'node:crypto';

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export function makeJwtVerifier({ issuer, jwksUrl, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  let keys = null;
  let lastFetch = 0;
  // Busca do JWKS em andamento: chamadas juntas (logo depois do login) esperam a mesma busca em vez
  // de verem o mapa ainda vazio e responderem 401
  let loading = null;

  async function load() {
    const res = await fetchImpl(jwksUrl);
    if (!res.ok) throw new Error(`JWKS indisponivel (HTTP ${res.status})`);
    const { keys: list = [] } = await res.json();
    keys = new Map(list.map((jwk) => [jwk.kid, createPublicKey({ key: jwk, format: 'jwk' })]));
  }

  async function keyFor(kid) {
    if (loading) await loading;
    if (!keys?.has(kid) && now() - lastFetch > 10_000) {
      lastFetch = now();
      loading = load().finally(() => { loading = null; });
      await loading;
    }
    return keys?.get(kid) ?? null;
  }

  /**
   * @param {string|undefined} header  valor do cabecalho Authorization
   * @param {string[]} audience        ids dos clients aceitos
   * @returns {Promise<{ok: true, claims: object} | {ok: false, reason: string}>}
   */
  async function check(header, audience) {
    const token = String(header ?? '').replace(/^Bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return { ok: false, reason: 'sem token' };
    let head;
    let claims;
    try {
      head = decodePart(parts[0]);
      claims = decodePart(parts[1]);
    } catch {
      return { ok: false, reason: 'token malformado' };
    }
    if (head.alg !== 'RS256') return { ok: false, reason: `alg ${head.alg}` };
    const key = await keyFor(head.kid);
    if (!key) return { ok: false, reason: 'kid desconhecido' };
    const signed = verifySignature('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!signed) return { ok: false, reason: 'assinatura invalida' };
    if (claims.iss !== issuer) return { ok: false, reason: 'emissor diferente' };
    const seconds = Math.floor(now() / 1000);
    if (typeof claims.exp !== 'number' || claims.exp <= seconds) return { ok: false, reason: 'expirado' };
    if (typeof claims.nbf === 'number' && claims.nbf > seconds) return { ok: false, reason: 'ainda nao valido' };
    const aud = claims.aud ?? claims.client_id;
    const auds = Array.isArray(aud) ? aud : [aud];
    if (!auds.some((a) => audience.includes(a))) return { ok: false, reason: 'audiencia nao aceita' };
    return { ok: true, claims };
  }

  return { check };
}

/**
 * Claims como o API Gateway HTTP API entrega a Lambda: tudo texto, listas como "[a b]"
 * (`cognito:groups` de um grupo so vira "[admin]", formato que domain/admin.js aceita).
 */
export function gatewayClaims(claims) {
  return Object.fromEntries(
    Object.entries(claims).map(([k, v]) => {
      if (Array.isArray(v)) return [k, `[${v.join(' ')}]`];
      if (v && typeof v === 'object') return [k, JSON.stringify(v)];
      return [k, String(v)];
    }),
  );
}
