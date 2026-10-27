import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  REMINDER_HOURS,
  configureReminders,
  loadReminderPrefs,
  openedFromReminder,
  pushSupport,
  remindersAvailable,
  renewPushOnOpen,
  setEmailReminders,
  setPushReminders,
  setReminderHour,
  vapidKeyBytes,
  __resetRemindersForTests,
  type PushApi,
} from '../lib/reminders';

// Lembretes (lib/reminders.ts): permissão do navegador, inscrição de push e escolhas guardadas. A API
// e o PushManager são falsos: nada sai do teste.

// Chave pública P-256 de exemplo (65 bytes em base64url, começa com 0x04)
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const session = { token: 'id-token', userId: 'sub-1' };

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

function fakeSubscription(endpoint = 'https://fcm.googleapis.com/fcm/send/abc') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'BPpub-key-1234', auth: 'auth-1234' } }),
    unsubscribe: vi.fn(async () => true),
  } as unknown as PushSubscription & { unsubscribe: ReturnType<typeof vi.fn> };
}

function fakePush(opts: { permission?: NotificationPermission; answer?: NotificationPermission; existing?: boolean } = {}) {
  let permission = opts.permission ?? 'default';
  let current: ReturnType<typeof fakeSubscription> | null = opts.existing ? fakeSubscription() : null;
  const subscribe = vi.fn(async () => (current = fakeSubscription()));
  const requestPermission = vi.fn(async () => (permission = opts.answer ?? 'granted'));
  const api: PushApi = {
    permission: () => permission,
    requestPermission,
    registration: async () =>
      ({
        pushManager: { getSubscription: async () => current, subscribe },
      }) as unknown as ServiceWorkerRegistration,
  };
  return { api, subscribe, requestPermission, current: () => current };
}

function setup(over: { push?: PushApi | null; vapidKey?: string; emailEnabled?: boolean; online?: boolean; responses?: Response[] } = {}) {
  const storage = memoryStorage();
  const queue = [...(over.responses ?? [])];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (queue.length) return queue.shift()!;
    if (url.endsWith('/v1/push/subscriptions')) return Response.json({ subscriptionId: 'a'.repeat(32) }, { status: 201 });
    return Response.json({ ok: true });
  });
  configureReminders({
    fetch: fetch as unknown as typeof globalThis.fetch,
    getSession: async () => session,
    apiBase: '/api',
    vapidKey: over.vapidKey ?? VAPID,
    emailEnabled: over.emailEnabled ?? true,
    storage,
    timeZone: () => 'America/Sao_Paulo',
    online: () => over.online ?? true,
    push: () => (over.push === undefined ? null : over.push),
    ios: () => false,
    standalone: () => false,
  });
  const body = (i: number) => JSON.parse(String(fetch.mock.calls[i][1]?.body ?? 'null'));
  const call = (i: number) => `${fetch.mock.calls[i][1]?.method} ${fetch.mock.calls[i][0]}`;
  return { storage, fetch, body, call };
}

beforeEach(() => __resetRemindersForTests());

describe('o que dá para oferecer', () => {
  it('sem chave VAPID nem e-mail ligado, nada aparece', () => {
    setup({ vapidKey: '', emailEnabled: false });
    expect(remindersAvailable()).toBe(false);
    expect(pushSupport()).toBe('unsupported');
  });

  it('horas fora do silêncio das 22h às 7h', () => {
    expect(REMINDER_HOURS[0]).toBe(7);
    expect(REMINDER_HOURS.at(-1)).toBe(21);
    expect(REMINDER_HOURS).toHaveLength(15);
  });

  it('iPhone no navegador pede para instalar; permissão bloqueada aparece como bloqueada', () => {
    setup();
    configureReminders({ vapidKey: VAPID, push: () => null, ios: () => true, standalone: () => false });
    expect(pushSupport()).toBe('install');
    setup({ push: fakePush({ permission: 'denied' }).api });
    expect(pushSupport()).toBe('denied');
    setup({ push: fakePush().api });
    expect(pushSupport()).toBe('ok');
  });

  it('a chave VAPID vira os 65 bytes que o PushManager espera', () => {
    const bytes = vapidKeyBytes(VAPID);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });

  it('aberto pelo toque no lembrete', () => {
    expect(openedFromReminder('https://app.librax.online/?origem=lembrete')).toBe(true);
    expect(openedFromReminder('https://app.librax.online/?origem=android')).toBe(false);
    expect(openedFromReminder('https://app.librax.online/learn')).toBe(false);
  });
});

describe('notificação no celular', () => {
  it('ligar pede a permissão, inscreve com o fuso e manda o horário', async () => {
    const push = fakePush();
    const { fetch, body, call, storage } = setup({ push: push.api });

    const r = await setPushReminders(true);

    expect(r.ok).toBe(true);
    expect(push.requestPermission).toHaveBeenCalledOnce();
    expect(push.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(call(0)).toBe('POST /api/v1/push/subscriptions');
    expect(body(0)).toEqual({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BPpub-key-1234', auth: 'auth-1234' },
      timezone: 'America/Sao_Paulo',
    });
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer id-token' });
    expect(call(1)).toBe('PUT /api/v1/notifications/preferences');
    expect(body(1)).toEqual({ reminderHour: 19, timezone: 'America/Sao_Paulo', emailOptIn: false });
    expect(loadReminderPrefs('sub-1')).toMatchObject({ push: true, subscriptionId: 'a'.repeat(32) });
    expect(storage.data.has('librax_reminders')).toBe(true);
  });

  it('permissão negada: não inscreve e não guarda', async () => {
    const push = fakePush({ answer: 'denied' });
    const { fetch } = setup({ push: push.api });
    expect(await setPushReminders(true)).toEqual({ ok: false, error: 'denied' });
    expect(push.subscribe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(loadReminderPrefs('sub-1').push).toBe(false);
  });

  it('desligar tira a inscrição no servidor e no navegador; sem nenhum canal, sem horário', async () => {
    const push = fakePush({ permission: 'granted' });
    const { call, body } = setup({ push: push.api });
    await setPushReminders(true);
    const sub = push.current()!;

    const r = await setPushReminders(false);

    expect(r.ok).toBe(true);
    expect(call(2)).toBe(`DELETE /api/v1/push/subscriptions/${'a'.repeat(32)}`);
    expect(sub.unsubscribe).toHaveBeenCalled();
    expect(body(3)).toEqual({ reminderHour: null, timezone: 'America/Sao_Paulo', emailOptIn: false });
    expect(loadReminderPrefs('sub-1')).toMatchObject({ push: false, subscriptionId: null });
  });

  it('sem internet: avisa e não muda nada', async () => {
    const { fetch } = setup({ push: fakePush().api, online: false });
    expect(await setPushReminders(true)).toEqual({ ok: false, error: 'offline' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('servidor recusou a inscrição: erro, sem guardar', async () => {
    setup({ push: fakePush().api, responses: [new Response('{}', { status: 500 })] });
    expect(await setPushReminders(true)).toEqual({ ok: false, error: 'error' });
    expect(loadReminderPrefs('sub-1').push).toBe(false);
  });
});

describe('e-mail e horário', () => {
  it('e-mail ligado com o horário; e-mail não confirmado vira aviso próprio', async () => {
    const { body } = setup();
    expect((await setEmailReminders(true)).ok).toBe(true);
    expect(body(0)).toEqual({ reminderHour: 19, timezone: 'America/Sao_Paulo', emailOptIn: true });

    setup({
      responses: [Response.json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'x' } }, { status: 400 })],
    });
    expect(await setEmailReminders(true)).toEqual({ ok: false, error: 'emailNotVerified' });
  });

  it('trocar o horário guarda e manda; hora no silêncio é recusada antes de chamar', async () => {
    const { body, fetch } = setup();
    await setEmailReminders(true);
    expect((await setReminderHour(8)).ok).toBe(true);
    expect(body(1)).toMatchObject({ reminderHour: 8, emailOptIn: true });
    expect(loadReminderPrefs('sub-1').hour).toBe(8);

    expect(await setReminderHour(23)).toEqual({ ok: false, error: 'error' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('escolhas de outra conta neste navegador não valem', async () => {
    setup();
    await setEmailReminders(true);
    expect(loadReminderPrefs('outra-conta')).toMatchObject({ email: false, push: false, hour: 19 });
  });
});

describe('na abertura do app', () => {
  it('com a notificação ligada: renova a inscrição e conta a abertura pelo lembrete', async () => {
    const push = fakePush({ permission: 'granted' });
    const { body, call } = setup({ push: push.api });
    await setPushReminders(true);

    expect(await renewPushOnOpen(true)).toBe(true);
    expect(call(2)).toBe('POST /api/v1/push/subscriptions');
    expect(body(2)).toMatchObject({ openedFromNotification: true, timezone: 'America/Sao_Paulo' });
  });

  it('desligada, ou sem conta: não chama nada', async () => {
    const { fetch } = setup({ push: fakePush({ permission: 'granted' }).api });
    expect(await renewPushOnOpen(false)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('permissão retirada no navegador: desliga aqui também, sem chamar a API', async () => {
    const { storage } = setup({ push: fakePush({ permission: 'granted' }).api });
    await setPushReminders(true);
    const fetch2 = vi.fn();
    configureReminders({
      fetch: fetch2 as unknown as typeof fetch,
      getSession: async () => session,
      vapidKey: VAPID,
      storage,
      push: () => fakePush({ permission: 'denied' }).api,
      online: () => true,
    });

    expect(await renewPushOnOpen(false)).toBe(false);
    expect(fetch2).not.toHaveBeenCalled();
    expect(loadReminderPrefs('sub-1')).toMatchObject({ push: false, subscriptionId: null });
  });
});
