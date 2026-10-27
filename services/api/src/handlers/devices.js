/**
 * POST /v1/users/me/devices: o app avisa em que aparelho a conta esta (depois de entrar e quando o
 * idioma muda). Corpo: `{ deviceId, lang?, timezone? }`. Resposta: `{ known: boolean }`.
 *
 * Guarda em USER#<id> / DEVICES os aparelhos conhecidos (hash do codigo, classe do User-Agent e
 * datas), o idioma e o fuso que o app informou por ultimo (usados tambem pelos lembretes). Aparelho
 * novo num login recente gera o aviso por e-mail pelo SES (domain/devices.js tem as regras e os
 * limites). Sem SES configurado (LOGIN_ALERT_FROM vazio), registra e nao manda nada.
 *
 * O e-mail sai no idioma que a conta ja tinha (o dono da conta, nao quem acabou de entrar) e com a
 * hora no fuso ja conhecido. O pais aproximado vem do cabecalho do CloudFront e so vai no e-mail:
 * nao e guardado, e o IP nunca e lido.
 */

import { parseDeviceReport, deviceKey, classifyUserAgent, isFreshLogin, registerDevice, withAlertSent } from '../domain/devices.js';
import { renderEmail } from '../email/render.js';
import { makeSesMailer } from '../adapters/sesMailer.js';
import { userId, claims, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

const header = (event, name) => {
  const headers = event.headers ?? {};
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
};

function verifiedEmail(c) {
  const verified = c.email_verified === true || c.email_verified === 'true';
  return verified && typeof c.email === 'string' ? c.email : null;
}

/**
 * @param {object} deps
 * @param {object} deps.repo
 * @param {{send(msg): Promise<void>}|null} deps.mailer  null = sem SES, sem aviso
 * @param {string} deps.appUrl
 */
export function makeDeviceHandlers({ repo, mailer = null, appUrl = '', now = () => new Date(), log = console.warn }) {
  const reportDeviceHandler = wrap(async (event) => {
    const uid = userId(event);
    let report;
    try {
      report = parseDeviceReport(body(event, { maxBytes: 1024 }));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(400, 'BAD_DEVICE', 'deviceId invalido');
    }
    const at = now();
    const c = claims(event);
    const device = classifyUserAgent(header(event, 'User-Agent'));
    const current = await repo.getDevices(uid);
    const r = registerDevice(current, {
      key: deviceKey(uid, report.deviceId),
      device,
      lang: report.lang,
      timezone: report.timezone,
      freshLogin: isFreshLogin(c.auth_time, at),
      now: at,
    });

    let next = r.next;
    const to = verifiedEmail(c);
    if (r.alert && mailer && to) {
      try {
        const email = renderEmail('newDevice', {
          lang: r.previous.lang ?? report.lang,
          appUrl,
          device,
          when: at,
          timeZone: r.previous.timezone ?? report.timezone ?? 'America/Sao_Paulo',
          country: header(event, 'CloudFront-Viewer-Country'),
          name: typeof c.given_name === 'string' ? c.given_name : null,
        });
        await mailer.send({ to, ...email });
        next = withAlertSent(next, at);
      } catch (err) {
        // O aviso nunca impede o uso do app; o aparelho fica registrado mesmo assim
        log('[devices] aviso de acesso novo falhou', { name: err.name });
      }
    }

    if (r.changed || next !== r.next) await repo.saveDevices(uid, next);
    return ok({ known: r.reason === 'KNOWN_DEVICE' });
  });

  return { reportDeviceHandler };
}

function productionMailer() {
  const from = process.env.LOGIN_ALERT_FROM;
  return from ? makeSesMailer({ from }) : null;
}

export const { reportDeviceHandler } = makeDeviceHandlers({
  repo: dynamoRepo,
  mailer: productionMailer(),
  appUrl: process.env.APP_URL ?? '',
});
