/**
 * Trava do ambiente local: nada sai para a AWS de verdade.
 *
 * Importar ANTES de qualquer modulo que crie client do AWS SDK (os handlers criam ao importar).
 *
 * - Credenciais falsas fixas e regiao us-east-1, ignorando ~/.aws e AWS_PROFILE do dono.
 * - AWS_ENDPOINT_URL aponta todo servico para o moto e AWS_ENDPOINT_URL_DYNAMODB para o
 *   DynamoDB Local. O que nao tem simulacao (Cost Explorer, CloudWatch, Web Push, SES) usa um
 *   falso explicito (fakes.mjs) e nunca chega a um client.
 * - http, https, fetch e dns recusam *.amazonaws.com e *.amazoncognito.com: se algo escapar das
 *   variaveis acima, falha alto em vez de chamar a nuvem.
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { URLS, REGION } from './config.mjs';

const BLOCKED_HOST = /(^|\.)(amazonaws\.com(\.cn)?|amazoncognito\.com|aws\.amazon\.com)\.?$/i;

export class AwsBlockedError extends Error {
  constructor(host) {
    super(`ambiente local: chamada para ${host} recusada (nada vai para a AWS de verdade)`);
    this.name = 'AwsBlockedError';
  }
}

export function isBlockedHost(host) {
  return typeof host === 'string' && BLOCKED_HOST.test(host.replace(/:\d+$/, ''));
}

function hostFromArgs(args) {
  const [first, second] = args;
  if (typeof first === 'string') return safeHost(first);
  if (first instanceof URL) return first.hostname;
  const opts = first && typeof first === 'object' ? first : second;
  return opts?.hostname ?? opts?.host ?? null;
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function guard(fn) {
  return function guarded(...args) {
    const host = hostFromArgs(args);
    if (isBlockedHost(host)) throw new AwsBlockedError(host);
    return fn.apply(this, args);
  };
}

let installed = false;

export function installAwsGuard() {
  if (installed) return;
  installed = true;

  const env = process.env;
  env.AWS_REGION = REGION;
  env.AWS_DEFAULT_REGION = REGION;
  env.AWS_ACCESS_KEY_ID = 'local';
  env.AWS_SECRET_ACCESS_KEY = 'local';
  delete env.AWS_SESSION_TOKEN;
  delete env.AWS_PROFILE;
  delete env.AWS_DEFAULT_PROFILE;
  env.AWS_SDK_LOAD_CONFIG = '0';
  env.AWS_CONFIG_FILE = '/dev/null';
  env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
  env.AWS_EC2_METADATA_DISABLED = 'true';
  env.AWS_ENDPOINT_URL = URLS.moto;
  env.AWS_ENDPOINT_URL_DYNAMODB = URLS.dynamodb;
  env.AWS_ENDPOINT_URL_COGNITO_IDENTITY_PROVIDER = URLS.moto;

  for (const mod of [http, https]) {
    mod.request = guard(mod.request);
    mod.get = guard(mod.get);
  }
  const lookup = dns.lookup;
  dns.lookup = function guardedLookup(hostname, ...rest) {
    if (isBlockedHost(hostname)) throw new AwsBlockedError(hostname);
    return lookup.call(this, hostname, ...rest);
  };
  const promisesLookup = dns.promises.lookup;
  dns.promises.lookup = (hostname, ...rest) =>
    isBlockedHost(hostname) ? Promise.reject(new AwsBlockedError(hostname)) : promisesLookup(hostname, ...rest);
  // os imports nomeados (`import { request } from 'https'`) passam a ver as versoes travadas
  syncBuiltinESMExports();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
    const host = safeHost(url);
    if (isBlockedHost(host)) return Promise.reject(new AwsBlockedError(host));
    return realFetch(input, init);
  };
}

installAwsGuard();
