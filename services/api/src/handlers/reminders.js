/**
 * Lambda de lembrete, disparada de hora em hora pelo EventBridge Scheduler
 * (plano mobile web 3.7 e decisao 11; regras na SPEC 05 12.3, ver domain/reminders.js).
 *
 * Web Push com a lib `web-push` (VAPID, sem Firebase). As chaves VAPID ficam no SSM
 * Parameter Store e sao lidas uma vez por container:
 *   VAPID_PUBLIC_KEY_PARAM   (String)       chave publica, a mesma do app (VITE_VAPID_PUBLIC_KEY)
 *   VAPID_PRIVATE_KEY_PARAM  (SecureString) chave privada
 *   VAPID_SUBJECT            mailto: ou https: de contato exigido pelos servicos de push
 *
 * E-mail via SES so com EMAIL_REMINDERS_ENABLED=true e EMAIL_FROM (identidade verificada);
 * cada pessoa precisa ter feito opt-in (PUT /v1/notifications/preferences). O e-mail sai em HTML e
 * texto, no idioma da pessoa (email/render.js), com o link para desligar em APP_URL/configuracoes.
 */

import webpush from 'web-push';
import { sendReminders } from '../usecases/sendReminders.js';
import { quietly, recordReminders } from '../usecases/opsMetrics.js';
import { opsToday } from '../domain/opsMetrics.js';
import { repo } from './_repo.js';
import { makeSesMailer, withSenderName } from '../adapters/sesMailer.js';

let vapidReady = null;

async function loadVapid() {
  const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm');
  const publicName = process.env.VAPID_PUBLIC_KEY_PARAM;
  const privateName = process.env.VAPID_PRIVATE_KEY_PARAM;
  const { Parameters = [] } = await new SSMClient({}).send(
    new GetParametersCommand({ Names: [publicName, privateName], WithDecryption: true }),
  );
  const value = (name) => Parameters.find((p) => p.Name === name)?.Value;
  // Sem as chaves (notificacoes ainda nao ligadas): segue so com o e-mail, sem erro
  if (!value(publicName) || !value(privateName)) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, value(publicName), value(privateName));
  return true;
}

const push = {
  send: (sub, payload) =>
    webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(payload), {
      TTL: 60 * 60, // lembrete velho nao serve: descarta depois de 1h sem entrega
      urgency: 'normal',
      topic: payload.tag, // substitui lembrete pendente do mesmo tipo
    }),
};

function makeMailer() {
  if (process.env.EMAIL_REMINDERS_ENABLED !== 'true' || !process.env.EMAIL_FROM) return null;
  return makeSesMailer({ from: withSenderName(process.env.EMAIL_FROM) });
}

export async function handler() {
  // So o sucesso fica guardado: sem chaves ou com erro, confere de novo na proxima execucao
  vapidReady ??= loadVapid().then(
    (ok) => {
      if (!ok) vapidReady = null;
      return ok;
    },
    (err) => {
      vapidReady = null;
      throw err;
    },
  );
  const pushOn = await vapidReady;
  if (!pushOn) console.warn('[reminders] sem chaves VAPID no SSM: so e-mail (lancar-cloudshell.sh --com-notificacoes)');

  const now = new Date();
  const report = await sendReminders(repo, {
    now,
    push: pushOn ? push : null,
    mail: makeMailer(),
    appUrl: process.env.APP_URL,
    log: (msg, data) => console.warn('[reminders]', msg, data),
  });
  console.log('[reminders]', JSON.stringify(report));
  // Painel (tela Operacao): entregues e falhas do dia; contador nunca derruba a rodada
  await quietly('lembretes', () => recordReminders(repo, { day: opsToday(now), report }));
  return report;
}
