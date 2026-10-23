/**
 * Handlers de Web Push e preferencias de lembrete (plano mobile web 3.7, decisao 11).
 *
 * POST   /v1/push/subscriptions                  -> inscreve (PushSubscription.toJSON())
 * DELETE /v1/push/subscriptions/{subscriptionId} -> remove
 * PUT    /v1/notifications/preferences           -> horario, fuso e opt-in de e-mail
 *
 * Itens: `USER#<id> / PUSH#<hash do endpoint>` e `USER#<id> / NOTIF` (preferencias + estado
 * usado pela Lambda de lembrete). O app chama a inscricao a cada abertura com o PushSubscription
 * atual: renova a inscricao e registra `lastSeenAt` (regra das 3h da SPEC 05 12.3); com
 * `openedFromNotification: true` (app aberto pela URL /?origem=lembrete) registra interacao.
 */

import {
  parsePushSubscription,
  parseNotificationPrefs,
  subscriptionId as hashEndpoint,
  SUBSCRIPTION_ID_RE,
} from '../domain/push.js';
import { recordSeen, recordInteraction, isValidTimeZone, DEFAULT_REMINDER_HOUR } from '../domain/reminders.js';
import { userId, claims, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const DOMAIN_ERRORS = {
  BAD_SUBSCRIPTION: 'Inscricao de push invalida',
  PUSH_HOST_NOT_ALLOWED: 'Servico de push nao reconhecido',
  BAD_PREFERENCES: 'Preferencias invalidas',
  BAD_REMINDER_HOUR: 'reminderHour deve ser inteiro entre 7 e 21 ou null',
  REMINDER_IN_QUIET_HOURS: 'Sem lembretes entre 22h e 7h',
  BAD_TIMEZONE: 'Fuso horario IANA invalido',
};

function domain(fn) {
  try {
    return fn();
  } catch (err) {
    if (DOMAIN_ERRORS[err.message]) throw new ApiError(400, err.message, DOMAIN_ERRORS[err.message]);
    throw err;
  }
}

/** E-mail so serve para lembrete se o Cognito diz que foi verificado. */
function verifiedEmail(event) {
  const c = claims(event);
  const verified = c.email_verified === true || c.email_verified === 'true';
  return verified && typeof c.email === 'string' ? c.email : null;
}

export function makePushHandlers({ repo, now = () => new Date() }) {
  const subscribePushHandler = wrap(async (event) => {
    const uid = userId(event);
    const raw = body(event, { maxBytes: 4 * 1024 });
    const sub = domain(() => parsePushSubscription(raw));
    const id = hashEndpoint(sub.endpoint);
    const at = now();

    await repo.putPushSubscription(uid, id, { ...sub, createdAt: at.toISOString() });

    const current = (await repo.getNotifState(uid)) ?? {
      reminderHour: DEFAULT_REMINDER_HOUR,
      timezone: isValidTimeZone(raw.timezone) ? raw.timezone : DEFAULT_TIMEZONE,
      emailOptIn: false,
      email: null,
    };
    const next = raw.openedFromNotification === true ? recordInteraction(current, at) : recordSeen(current, at);
    await repo.saveNotifState(uid, next, at);

    return ok({ subscriptionId: id }, 201);
  });

  const unsubscribePushHandler = wrap(async (event) => {
    const uid = userId(event);
    const id = event.pathParameters?.subscriptionId;
    if (typeof id !== 'string' || !SUBSCRIPTION_ID_RE.test(id)) {
      throw new ApiError(400, 'BAD_SUBSCRIPTION_ID', 'subscriptionId invalido');
    }
    await repo.deletePushSubscription(uid, id);
    return ok({ ok: true });
  });

  const updateNotificationPrefsHandler = wrap(async (event) => {
    const uid = userId(event);
    const prefs = domain(() => parseNotificationPrefs(body(event, { maxBytes: 2 * 1024 })));
    const email = prefs.emailOptIn ? verifiedEmail(event) : null;
    if (prefs.emailOptIn && !email) {
      throw new ApiError(400, 'EMAIL_NOT_VERIFIED', 'Lembrete por e-mail exige e-mail verificado na conta');
    }
    const at = now();
    const current = (await repo.getNotifState(uid)) ?? {};
    await repo.saveNotifState(uid, recordSeen({ ...current, ...prefs, email }, at), at);
    return ok(prefs);
  });

  return { subscribePushHandler, unsubscribePushHandler, updateNotificationPrefsHandler };
}

export const { subscribePushHandler, unsubscribePushHandler, updateNotificationPrefsHandler } = makePushHandlers({
  repo: dynamoRepo,
});
