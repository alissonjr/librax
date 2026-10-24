/**
 * Chamadas ao cognito-idp do moto (protocolo JSON da AWS, X-Amz-Target), sem SDK.
 *
 * O moto nao confere assinatura: o bootstrap, o proxy e a pagina de login falam com ele direto.
 * Todo pedido que chega ao moto entra na gravacao (persistencia por replay), entao quem chama
 * evita leituras repetidas (os ids ficam no state.json).
 */

import { URLS } from './config.mjs';

export const COGNITO_TARGET_PREFIX = 'AWSCognitoIdentityProviderService.';

export class CognitoError extends Error {
  constructor(type, message, status = 400) {
    super(message || type);
    this.name = type;
    this.type = type;
    this.status = status;
  }
}

/** Repassa um corpo ja serializado; devolve a resposta crua (status, cabecalhos e texto). */
export async function motoRaw(target, rawBody) {
  const res = await fetch(URLS.moto, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `${COGNITO_TARGET_PREFIX}${target}`,
    },
    body: rawBody,
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** Chama uma acao do cognito-idp; erro do moto vira CognitoError com o __type. */
export async function cognito(target, body = {}) {
  const res = await motoRaw(target, JSON.stringify(body));
  const json = res.text ? JSON.parse(res.text) : {};
  if (res.status >= 400) {
    const type = String(json.__type ?? res.headers.get('x-amzn-errortype') ?? 'UnknownError').split('#').pop().split(':')[0];
    throw new CognitoError(type, json.message ?? json.Message, res.status);
  }
  return json;
}

/** Endpoints do proprio moto (/moto-api/...). */
export async function motoApi(path, { method = 'POST', body } = {}) {
  const res = await fetch(`${URLS.moto}/moto-api/${path}`, { method, body });
  return { status: res.status, text: await res.text() };
}

export async function motoReachable() {
  try {
    // so a conexao: qualquer pedido HTTP ao moto entraria na gravacao
    const net = await import('node:net');
    const { hostname, port } = new URL(URLS.moto);
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: hostname, port: Number(port) }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', reject);
      socket.setTimeout(1500, () => socket.destroy(new Error('timeout')));
    });
    return true;
  } catch {
    return false;
  }
}

/** Atributos do Cognito ([{ Name, Value }]) como objeto. */
export const attrsOf = (list = []) => Object.fromEntries(list.map((a) => [a.Name, a.Value]));
