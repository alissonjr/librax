import { getSession, type Session } from './auth';
import { isIos, isStandalone } from './install';
import { DEFAULT_REMINDER_HOUR, QUIET_END_HOUR, QUIET_START_HOUR, REMINDER_URL } from '@domain/reminders.js';

/**
 * Lembretes de estudo (spec-05 12; plano mobile web, decisão 11): notificação no celular (Web Push)
 * e e-mail opcional. Quando mandar é decidido no servidor (services/api/src/domain/reminders.js, de
 * hora em hora); aqui ficam a permissão, a inscrição deste navegador e as escolhas da pessoa.
 *
 * - POST /v1/push/subscriptions: inscreve este navegador. A cada abertura do app a inscrição é
 *   renovada, o que também conta como "abriu o app" (sem lembrete nas 3 horas seguintes); aberto
 *   pelo lembrete (`/?origem=lembrete`), conta como interação.
 * - DELETE /v1/push/subscriptions/{id}: tira este navegador.
 * - PUT /v1/notifications/preferences: horário, fuso e e-mail (o endereço vem da conta, verificado).
 *
 * O servidor não devolve as escolhas, então a última fica neste navegador, por conta. Só com conta:
 * as rotas pedem login. Sem a chave VAPID no build, o push não aparece; sem o e-mail ligado na infra
 * (VITE_EMAIL_REMINDERS), a opção de e-mail também não.
 */

const STORAGE_KEY = 'librax_reminders';
export const REMINDER_TIMEOUT_MS = 10_000;

/** Horas que a pessoa pode escolher: fora do silêncio das 22h às 7h. */
export const REMINDER_HOURS: number[] = Array.from(
  { length: QUIET_START_HOUR - QUIET_END_HOUR },
  (_, i) => QUIET_END_HOUR + i,
);
export { DEFAULT_REMINDER_HOUR };

export interface ReminderPrefs {
  /** Conta dona destas escolhas (outra conta neste navegador começa do zero). */
  userId: string;
  hour: number;
  push: boolean;
  email: boolean;
  /** Id da inscrição deste navegador no servidor (para tirar). */
  subscriptionId: string | null;
}

/**
 * - `ok`: dá para ligar;
 * - `install`: iPhone ou iPad no navegador (o push só existe com o app na tela inicial);
 * - `denied`: a pessoa bloqueou as notificações do site;
 * - `unsupported`: navegador sem Web Push, ou build sem a chave VAPID.
 */
export type PushSupport = 'ok' | 'install' | 'denied' | 'unsupported';

export type ReminderError = 'offline' | 'denied' | 'emailNotVerified' | 'error';
export type ReminderResult = { ok: true; prefs: ReminderPrefs } | { ok: false; error: ReminderError };

export interface ReminderDeps {
  fetch: typeof fetch;
  getSession: () => Promise<Session | null>;
  apiBase: string;
  vapidKey: string;
  emailEnabled: boolean;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  timeZone: () => string;
  online: () => boolean;
  /** Notification, PushManager e service worker (null sem suporte). */
  push: () => PushApi | null;
  ios: () => boolean;
  standalone: () => boolean;
}

export interface PushApi {
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  registration: () => Promise<Pick<ServiceWorkerRegistration, 'pushManager'>>;
}

function browserPush(): PushApi | null {
  if (typeof window === 'undefined') return null;
  if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return null;
  return {
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    registration: () => navigator.serviceWorker.ready,
  };
}

const defaults = (): ReminderDeps => ({
  fetch: (...args) => fetch(...args),
  getSession,
  apiBase: import.meta.env.VITE_API_BASE || '/api',
  vapidKey: import.meta.env.VITE_VAPID_PUBLIC_KEY ?? '',
  emailEnabled: import.meta.env.VITE_EMAIL_REMINDERS === 'true',
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  timeZone: () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
    } catch {
      return 'America/Sao_Paulo';
    }
  },
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  push: browserPush,
  ios: () => isIos(),
  standalone: () => isStandalone(),
});

let deps: ReminderDeps = defaults();

/** Testes: troca as dependências (rede, sessão, push do navegador). */
export function configureReminders(overrides: Partial<ReminderDeps>): void {
  deps = { ...defaults(), ...overrides };
}

export function __resetRemindersForTests(): void {
  deps = defaults();
}

/** Conta conectada (sub do Cognito), dona das escolhas guardadas. */
export async function currentAccountId(): Promise<string | null> {
  try {
    return (await deps.getSession())?.userId ?? null;
  } catch {
    return null;
  }
}

/** Algum lembrete pode ser oferecido neste build (push com chave VAPID ou e-mail ligado na infra). */
export function remindersAvailable(): boolean {
  return deps.vapidKey !== '' || deps.emailEnabled;
}

export function emailRemindersAvailable(): boolean {
  return deps.emailEnabled;
}

export function pushSupport(): PushSupport {
  if (!deps.vapidKey) return 'unsupported';
  const api = deps.push();
  if (!api) return deps.ios() && !deps.standalone() ? 'install' : 'unsupported';
  return api.permission() === 'denied' ? 'denied' : 'ok';
}

function blank(userId: string): ReminderPrefs {
  return { userId, hour: DEFAULT_REMINDER_HOUR, push: false, email: false, subscriptionId: null };
}

/** Escolhas guardadas para a conta (padrão: tudo desligado, às 19h). */
export function loadReminderPrefs(userId: string): ReminderPrefs {
  try {
    const raw = JSON.parse(deps.storage?.getItem(STORAGE_KEY) ?? 'null') as Partial<ReminderPrefs> | null;
    if (!raw || raw.userId !== userId) return blank(userId);
    return {
      userId,
      hour: REMINDER_HOURS.includes(raw.hour as number) ? (raw.hour as number) : DEFAULT_REMINDER_HOUR,
      push: raw.push === true,
      email: raw.email === true,
      subscriptionId: typeof raw.subscriptionId === 'string' ? raw.subscriptionId : null,
    };
  } catch {
    return blank(userId);
  }
}

function saveReminderPrefs(prefs: ReminderPrefs): void {
  try {
    deps.storage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* sem armazenamento: vale até fechar */
  }
}

/** Chave pública VAPID em base64url para o formato do PushManager. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Service worker pronto, com prazo: sem ele (modo de desenvolvimento) o `ready` nunca resolve. */
function registration(api: PushApi): Promise<Pick<ServiceWorkerRegistration, 'pushManager'>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('service worker ausente')), REMINDER_TIMEOUT_MS);
    api.registration().then(
      (reg) => { clearTimeout(timer); resolve(reg); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function call(session: Session, method: string, path: string, body?: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REMINDER_TIMEOUT_MS);
  try {
    return await deps.fetch(`${deps.apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function failure(res: Response): Promise<ReminderError> {
  try {
    const data = (await res.json()) as { error?: { code?: string } };
    if (data.error?.code === 'EMAIL_NOT_VERIFIED') return 'emailNotVerified';
  } catch {
    /* corpo sem JSON */
  }
  return 'error';
}

async function putPrefs(session: Session, prefs: ReminderPrefs): Promise<ReminderError | null> {
  const res = await call(session, 'PUT', '/v1/notifications/preferences', {
    // Sem nenhum canal, sem lembrete diário no servidor
    reminderHour: prefs.push || prefs.email ? prefs.hour : null,
    timezone: deps.timeZone(),
    emailOptIn: prefs.email,
  });
  return res.ok ? null : failure(res);
}

async function sendSubscription(session: Session, sub: PushSubscription, openedFromNotification: boolean) {
  const res = await call(session, 'POST', '/v1/push/subscriptions', {
    ...sub.toJSON(),
    timezone: deps.timeZone(),
    ...(openedFromNotification ? { openedFromNotification: true } : {}),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { subscriptionId?: string } | null;
  return typeof data?.subscriptionId === 'string' ? data.subscriptionId : null;
}

async function withSession(fn: (session: Session) => Promise<ReminderResult>): Promise<ReminderResult> {
  if (!deps.online()) return { ok: false, error: 'offline' };
  try {
    const session = await deps.getSession();
    if (!session) return { ok: false, error: 'error' };
    return await fn(session);
  } catch {
    return { ok: false, error: deps.online() ? 'error' : 'offline' };
  }
}

/**
 * Liga ou desliga a notificação neste navegador. Ligar pede a permissão do navegador (precisa vir de
 * um toque da pessoa), inscreve e manda o horário.
 */
export function setPushReminders(on: boolean): Promise<ReminderResult> {
  return withSession(async (session) => {
    const api = deps.push();
    if (!api || !deps.vapidKey) return { ok: false, error: 'error' };
    const prefs = loadReminderPrefs(session.userId);
    const reg = await registration(api);
    if (on) {
      const permission = api.permission() === 'granted' ? 'granted' : await api.requestPermission();
      if (permission !== 'granted') return { ok: false, error: 'denied' };
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(deps.vapidKey) }));
      const subscriptionId = await sendSubscription(session, sub, false);
      if (!subscriptionId) return { ok: false, error: 'error' };
      const next = { ...prefs, push: true, subscriptionId };
      const err = await putPrefs(session, next);
      if (err) return { ok: false, error: err };
      saveReminderPrefs(next);
      return { ok: true, prefs: next };
    }
    const sub = await reg.pushManager.getSubscription();
    if (prefs.subscriptionId) {
      const res = await call(session, 'DELETE', `/v1/push/subscriptions/${prefs.subscriptionId}`);
      if (!res.ok && res.status !== 404) return { ok: false, error: 'error' };
    }
    await sub?.unsubscribe().catch(() => false);
    const next = { ...prefs, push: false, subscriptionId: null };
    const err = await putPrefs(session, next);
    if (err) return { ok: false, error: err };
    saveReminderPrefs(next);
    return { ok: true, prefs: next };
  });
}

/** Liga ou desliga o lembrete por e-mail (para o e-mail verificado da conta). */
export function setEmailReminders(on: boolean): Promise<ReminderResult> {
  return withSession(async (session) => {
    const next = { ...loadReminderPrefs(session.userId), email: on };
    const err = await putPrefs(session, next);
    if (err) return { ok: false, error: err };
    saveReminderPrefs(next);
    return { ok: true, prefs: next };
  });
}

/** Troca o horário do lembrete (vale para a notificação e para o e-mail). */
export function setReminderHour(hour: number): Promise<ReminderResult> {
  return withSession(async (session) => {
    if (!REMINDER_HOURS.includes(hour)) return { ok: false, error: 'error' };
    const next = { ...loadReminderPrefs(session.userId), hour };
    const err = await putPrefs(session, next);
    if (err) return { ok: false, error: err };
    saveReminderPrefs(next);
    return { ok: true, prefs: next };
  });
}

/** O app foi aberto pelo toque no lembrete (`/?origem=lembrete`). */
export function openedFromReminder(href: string = typeof window === 'undefined' ? '' : window.location.href): boolean {
  try {
    const url = new URL(href);
    const target = new URL(REMINDER_URL, url.origin);
    return url.pathname === target.pathname && url.searchParams.get('origem') === target.searchParams.get('origem');
  } catch {
    return false;
  }
}

/** Lido ao carregar o app, antes de o roteador trocar o endereço. */
const OPENED_FROM_REMINDER = openedFromReminder();

/**
 * Na abertura do app, com conta e a notificação ligada: renova a inscrição (o navegador pode ter
 * trocado o endereço) e avisa que o app foi aberto. Permissão retirada no navegador desliga aqui
 * também. Falha de rede não muda nada: tenta na próxima abertura.
 */
export async function renewPushOnOpen(openedFromNotification = OPENED_FROM_REMINDER): Promise<boolean> {
  try {
    const api = deps.push();
    if (!api || !deps.vapidKey || !deps.online()) return false;
    const session = await deps.getSession();
    if (!session) return false;
    const prefs = loadReminderPrefs(session.userId);
    if (!prefs.push) return false;
    if (api.permission() !== 'granted') {
      saveReminderPrefs({ ...prefs, push: false, subscriptionId: null });
      return false;
    }
    const reg = await registration(api);
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(deps.vapidKey) }));
    const subscriptionId = await sendSubscription(session, sub, openedFromNotification);
    if (!subscriptionId) return false;
    if (subscriptionId !== prefs.subscriptionId) saveReminderPrefs({ ...prefs, subscriptionId });
    return true;
  } catch {
    return false;
  }
}
