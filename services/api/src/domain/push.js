import { createHash } from 'node:crypto';
import { isValidTimeZone, QUIET_START_HOUR, QUIET_END_HOUR } from './reminders.js';

/**
 * Inscricoes de Web Push (VAPID) e preferencias de lembrete (plano mobile web 3.7,
 * decisao 11; SPEC 02 secao 9).
 *
 * A inscricao vem de PushSubscription.toJSON() no navegador. O endpoint e uma URL que a
 * Lambda de lembrete vai chamar por POST, entao so servicos de push conhecidos passam:
 * sem isso, qualquer usuario poderia fazer a Lambda chamar um endereco interno (SSRF).
 */

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge e Samsung Internet no Android
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari (iOS 16.4+ com app na tela inicial, macOS)
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/, // Edge no Windows
];

const ENDPOINT_MAX = 1024;
const KEY_RE = /^[A-Za-z0-9_-]{8,256}={0,2}$/; // base64url
export const SUBSCRIPTION_ID_RE = /^[0-9a-f]{32}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code) => {
  throw new Error(code);
};

/** Id estavel da inscricao: hash do endpoint (o endpoint nao vira chave nem aparece em log). */
export function subscriptionId(endpoint) {
  return createHash('sha256').update(endpoint).digest('hex').slice(0, 32);
}

/**
 * Valida a inscricao. Lanca Error('BAD_SUBSCRIPTION' | 'PUSH_HOST_NOT_ALLOWED').
 * @returns {{endpoint: string, keys: {p256dh: string, auth: string}}}
 */
export function parsePushSubscription(raw) {
  if (!isObject(raw) || !isObject(raw.keys)) fail('BAD_SUBSCRIPTION');
  const { endpoint } = raw;
  if (typeof endpoint !== 'string' || endpoint.length > ENDPOINT_MAX) fail('BAD_SUBSCRIPTION');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    fail('BAD_SUBSCRIPTION');
  }
  if (url.protocol !== 'https:' || url.port || url.username || url.password) fail('PUSH_HOST_NOT_ALLOWED');
  if (!PUSH_HOSTS.some((re) => re.test(url.hostname))) fail('PUSH_HOST_NOT_ALLOWED');

  const { p256dh, auth } = raw.keys;
  if (typeof p256dh !== 'string' || !KEY_RE.test(p256dh)) fail('BAD_SUBSCRIPTION');
  if (typeof auth !== 'string' || !KEY_RE.test(auth)) fail('BAD_SUBSCRIPTION');
  return { endpoint, keys: { p256dh, auth } };
}

/**
 * Valida as preferencias de lembrete. Lanca Error(codigo).
 * - reminderHour: hora local inteira fora do silencio (7 a 21) ou null (sem lembrete diario);
 * - timezone: fuso IANA;
 * - emailOptIn: booleano (o e-mail vem do token, nunca do corpo).
 */
export function parseNotificationPrefs(raw) {
  if (!isObject(raw)) fail('BAD_PREFERENCES');
  const { reminderHour = null, timezone, emailOptIn = false } = raw;
  if (reminderHour !== null) {
    if (!Number.isInteger(reminderHour) || reminderHour < 0 || reminderHour > 23) fail('BAD_REMINDER_HOUR');
    if (reminderHour >= QUIET_START_HOUR || reminderHour < QUIET_END_HOUR) fail('REMINDER_IN_QUIET_HOURS');
  }
  if (!isValidTimeZone(timezone)) fail('BAD_TIMEZONE');
  if (typeof emailOptIn !== 'boolean') fail('BAD_PREFERENCES');
  return { reminderHour, timezone, emailOptIn };
}
