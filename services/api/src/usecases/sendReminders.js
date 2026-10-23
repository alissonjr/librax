import { newProfile } from '../domain/profile.js';
import { decideReminder, candidateBuckets, REMINDER_URL } from '../domain/reminders.js';

/**
 * Rodada de lembretes (Lambda disparada de hora em hora pelo EventBridge Scheduler).
 *
 * 1. Lista os candidatos dos baldes de fuso que estao fora do silencio agora (GSI6).
 * 2. decideReminder aplica as regras da SPEC 05 12.3 com o fuso exato de cada um.
 * 3. Entrega por Web Push em todas as inscricoes; inscricao expirada (404/410) e apagada.
 * 4. Sem push entregue: e-mail, so com opt-in e com o envio de e-mail ligado (`mail`).
 * 5. Grava o estado so quando entregou (ou quando comecou uma pausa).
 *
 * @param {object} repo
 * @param {object} deps
 * @param {Date}   deps.now
 * @param {{send(sub, payload): Promise<void>}} deps.push   porta de Web Push
 * @param {{send(msg): Promise<void>}} [deps.mail]          porta de e-mail (SES); omitida = desligado
 * @param {(msg: string, data?: object) => void} [deps.log]
 */
export async function sendReminders(repo, { now, push, mail = null, log = () => {} }) {
  const report = { evaluated: 0, sent: 0, skipped: {} };
  const skip = (reason) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };

  for (const bucket of candidateBuckets(now)) {
    for (const notif of await repo.listNotifCandidates(bucket)) {
      report.evaluated += 1;
      const { userId } = notif;
      const profile = (await repo.getProfile(userId)) ?? newProfile(userId);
      const decision = decideReminder({ now, prefs: notif, profile, state: notif });

      if (!decision.send) {
        skip(decision.reason);
        if (decision.nextState) await repo.saveNotifState(userId, { ...notif, ...decision.nextState }, now);
        continue;
      }

      const payload = { ...decision.message, url: REMINDER_URL, tag: `librax-${decision.kind}` };
      let delivered = 0;
      for (const sub of await repo.listPushSubscriptions(userId)) {
        try {
          await push.send(sub, payload);
          delivered += 1;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await repo.deletePushSubscription(userId, sub.subscriptionId);
          } else {
            log('push falhou', { userId, statusCode: err.statusCode ?? null });
          }
        }
      }

      if (delivered === 0 && mail && notif.emailOptIn && notif.email) {
        try {
          await mail.send({ to: notif.email, subject: payload.title, text: payload.body });
          delivered += 1;
        } catch (err) {
          log('e-mail falhou', { userId, name: err.name });
        }
      }

      if (delivered === 0) {
        skip('NO_CHANNEL');
        continue;
      }
      await repo.saveNotifState(userId, { ...notif, ...decision.nextState }, now);
      report.sent += 1;
    }
  }
  return report;
}
