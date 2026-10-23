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
 * cada pessoa precisa ter feito opt-in (PUT /v1/notifications/preferences).
 */

import webpush from 'web-push';
import { sendReminders } from '../usecases/sendReminders.js';
import { repo } from './_repo.js';

let vapidReady = null;

async function loadVapid() {
  const { SSMClient, GetParametersCommand } = await import('@aws-sdk/client-ssm');
  const publicName = process.env.VAPID_PUBLIC_KEY_PARAM;
  const privateName = process.env.VAPID_PRIVATE_KEY_PARAM;
  const { Parameters = [] } = await new SSMClient({}).send(
    new GetParametersCommand({ Names: [publicName, privateName], WithDecryption: true }),
  );
  const value = (name) => Parameters.find((p) => p.Name === name)?.Value;
  if (!value(publicName) || !value(privateName)) throw new Error('chaves VAPID ausentes no SSM');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT, value(publicName), value(privateName));
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
  let client;
  return {
    async send({ to, subject, text }) {
      const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
      client ??= new SESv2Client({});
      const footer = `\n\nPara parar de receber, desligue o lembrete por e-mail em ${process.env.APP_URL ?? ''}/configuracoes.`;
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: process.env.EMAIL_FROM,
          Destination: { ToAddresses: [to] },
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: text + footer, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}

export async function handler() {
  vapidReady ??= loadVapid().catch((err) => {
    vapidReady = null; // tenta de novo na proxima execucao
    throw err;
  });
  await vapidReady;

  const report = await sendReminders(repo, {
    now: new Date(),
    push,
    mail: makeMailer(),
    log: (msg, data) => console.warn('[reminders]', msg, data),
  });
  console.log('[reminders]', JSON.stringify(report));
  return report;
}
