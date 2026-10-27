import { createHash } from 'node:crypto';
import { isValidTimeZone } from './reminders.js';
import { parseLang } from '../email/render.js';

/**
 * Aparelhos conhecidos da conta e o aviso de acesso novo por e-mail (feito por nos, sem o plano pago
 * do Cognito). Regras puras; o handler esta em handlers/devices.js.
 *
 * Como funciona:
 * - O app cria um codigo aleatorio por navegador (`librax_deviceId`, sem impressao digital do
 *   aparelho) e, com conta, chama POST /v1/users/me/devices depois de entrar e quando o idioma muda.
 * - O servidor guarda so um hash do codigo junto com o id da conta (o codigo em si nunca fica na
 *   tabela), a classe do aparelho tirada do User-Agent (celular, tablet ou computador, o sistema e o
 *   navegador, nunca o User-Agent inteiro) e as datas da primeira e da ultima vez. Sem IP.
 * - Aparelho que a conta ainda nao tinha, num login recente (`auth_time` do token com ate 15 min),
 *   gera o aviso. O primeiro aparelho da conta nao gera (cadastro ou primeiro uso depois do
 *   lancamento), e sessao antiga num aparelho ainda nao registrado so e registrada em silencio.
 * - Limites: ate 10 aparelhos por conta (sai o visto ha mais tempo) e ate 3 avisos em 24 horas.
 */

export const MAX_DEVICES = 10;
export const MAX_ALERTS_PER_DAY = 3;
export const FRESH_LOGIN_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const fail = (code) => {
  throw new Error(code);
};

/**
 * Corpo do POST: `deviceId` obrigatorio; `lang` e `timezone` opcionais (invalidos sao ignorados).
 * Lanca Error('BAD_DEVICE').
 */
export function parseDeviceReport(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail('BAD_DEVICE');
  const { deviceId, lang, timezone } = raw;
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) fail('BAD_DEVICE');
  return {
    deviceId,
    lang: parseLang(lang),
    timezone: isValidTimeZone(timezone) ? timezone : null,
  };
}

/** Chave do aparelho na conta: hash do codigo com o id da conta (o codigo nao fica guardado). */
export function deviceKey(userId, deviceId) {
  return createHash('sha256').update(`${userId}\n${deviceId}`).digest('hex').slice(0, 32);
}

/**
 * Classe do aparelho a partir do User-Agent: so tipo, sistema e navegador conhecidos.
 * @returns {{kind: 'mobile'|'tablet'|'desktop'|'unknown', os: string|null, browser: string|null}}
 */
export function classifyUserAgent(ua) {
  if (typeof ua !== 'string' || ua.length === 0) return { kind: 'unknown', os: null, browser: null };
  const s = ua.slice(0, 512);

  let os = null;
  if (/iPad/.test(s)) os = 'iPadOS';
  else if (/iPhone|iPod/.test(s)) os = 'iOS';
  else if (/Android/.test(s)) os = 'Android';
  else if (/CrOS/.test(s)) os = 'ChromeOS';
  else if (/Windows/.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(s)) os = 'macOS';
  else if (/Linux/.test(s)) os = 'Linux';

  let browser = null;
  if (/SamsungBrowser\//.test(s)) browser = 'Samsung Internet';
  else if (/EdgA?\/|EdgiOS\//.test(s)) browser = 'Edge';
  else if (/OPR\/|OPiOS\//.test(s)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(s)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(s)) browser = 'Chrome';
  else if (/Safari\//.test(s) && /Version\//.test(s)) browser = 'Safari';

  let kind = 'unknown';
  if (os === 'iPadOS' || (os === 'Android' && !/Mobile/.test(s)) || /Tablet/.test(s)) kind = 'tablet';
  else if (os === 'iOS' || os === 'Android' || /Mobile/.test(s)) kind = 'mobile';
  else if (os) kind = 'desktop';

  return { kind, os, browser };
}

/** `auth_time` do token (segundos) dentro da janela de login recente. */
export function isFreshLogin(authTime, now) {
  const t = Number(authTime);
  if (!Number.isFinite(t) || t <= 0) return false;
  const age = now.getTime() - t * 1000;
  return age >= -60 * 1000 && age <= FRESH_LOGIN_MS;
}

/**
 * Registra o aparelho e decide o aviso.
 *
 * @param {object|null} record  item atual (USER#<id> / DEVICES) ou null
 * @param {object} args
 * @param {string} args.key        deviceKey(...)
 * @param {object} args.device     classifyUserAgent(...)
 * @param {string|null} args.lang
 * @param {string|null} args.timezone
 * @param {boolean} args.freshLogin
 * @param {Date} args.now
 * @returns {{next: object, changed: boolean, alert: boolean, reason: string,
 *            previous: {lang: string|null, timezone: string|null}}}
 */
export function registerDevice(record, { key, device, lang, timezone, freshLogin, now }) {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const devices = Array.isArray(record?.devices) ? record.devices.map((d) => ({ ...d })) : [];
  const previous = { lang: record?.lang ?? null, timezone: record?.timezone ?? null };
  const alerts = (Array.isArray(record?.alertsSentAt) ? record.alertsSentAt : []).filter(
    (iso) => now.getTime() - Date.parse(iso) < DAY_MS,
  );

  const known = devices.find((d) => d.id === key);
  let changed = false;
  let reason;

  if (known) {
    reason = 'KNOWN_DEVICE';
    if (known.lastSeenAt?.slice(0, 10) !== today) {
      known.lastSeenAt = nowIso;
      changed = true;
    }
  } else {
    if (devices.length === 0) reason = 'FIRST_DEVICE';
    else if (!freshLogin) reason = 'OLD_SESSION';
    else if (alerts.length >= MAX_ALERTS_PER_DAY) reason = 'ALERT_LIMIT';
    else reason = 'NEW_DEVICE';
    devices.push({ id: key, kind: device.kind, os: device.os, browser: device.browser, firstSeenAt: nowIso, lastSeenAt: nowIso });
    devices.sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''));
    devices.splice(MAX_DEVICES);
    changed = true;
  }

  const nextLang = lang ?? previous.lang;
  const nextTz = timezone ?? previous.timezone;
  if (nextLang !== previous.lang || nextTz !== previous.timezone) changed = true;

  const next = { devices, lang: nextLang, timezone: nextTz, alertsSentAt: alerts, updatedAt: nowIso };
  return { next, changed: changed || alerts.length !== (record?.alertsSentAt?.length ?? 0), alert: reason === 'NEW_DEVICE', reason, previous };
}

/** Marca um aviso enviado (conta no limite de 24 horas). */
export function withAlertSent(record, now) {
  return { ...record, alertsSentAt: [...(record.alertsSentAt ?? []), now.toISOString()] };
}
