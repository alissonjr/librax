import { isOnboarded } from './auth';
import { BUILD } from './appVersion';
import { isIos, isStandalone } from './install';
import { isTwa } from './twa';
import { onAppReopen } from './appOpen';

/**
 * Dados de uso anônimos (política de privacidade, item "Dados de uso anônimos"; servidor em
 * services/api/src/handlers/telemetry.js). Servem para calibrar o algoritmo e os exercícios, sem
 * identificar a pessoa.
 *
 * - Mão única: o app manda eventos e um retrato do progresso; nada volta. O progresso local continua
 *   sendo o que guia o caminho do curso, e a conta e a migração do convidado (sync.ts) não mudam.
 * - Código anônimo próprio (`librax_telemetryId`, crypto.randomUUID): diferente do id local
 *   (`librax_userId`), do código do aparelho da conta (`librax_deviceId`, device.ts) e da conta. Nunca
 *   vão nome, e-mail, id de conta, id local nem o código do aparelho. O código muda quando a pessoa
 *   desliga e liga de novo e quando apaga os dados.
 * - Fila no localStorage (até MAX_QUEUE eventos; os mais velhos saem), em lotes de até MAX_BATCH. Envio
 *   no fim da lição e quando o app sai da tela (sendBeacon, ou fetch com keepalive). Erro de rede
 *   nunca chega à tela: o lote fica para a próxima.
 * - Nada sai antes de terminar as boas-vindas (o aceite da política); até lá os eventos só esperam.
 * - Desligado em Configurações: para de guardar e de mandar, apaga a fila e o código e pede ao
 *   servidor para apagar a cópia (DELETE /v1/telemetry/{id}), com nova tentativa se estiver sem rede.
 *
 * A nota do app (sendFeedback) usa o mesmo código e a mesma ideia de fila. Com os dados de uso
 * desligados, a nota vai mesmo assim (é uma ação da pessoa), com um código aleatório só dela.
 */

export type Lang = 'pt-BR' | 'en' | 'es';
export type Platform = 'android' | 'ios' | 'desktop' | 'other';
export type Installed = 'browser' | 'pwa' | 'twa';

export type TelemetryEvent =
  | { type: 'app_open' }
  | { type: 'onboarding_done'; lang: Lang; dailyGoal: number }
  | { type: 'lesson_open'; lessonId: string }
  | { type: 'lesson_complete'; lessonId: string; score: number; xp: number; durationSec?: number }
  | { type: 'lesson_abandon'; lessonId: string; exerciseIndex: number; exerciseCount: number }
  | { type: 'daily_goal_met' }
  | { type: 'placement_started'; camera: boolean }
  | { type: 'placement_done'; placed: number }
  | { type: 'practice_done'; mode: 'review' | 'free'; items: number; correct: number }
  | { type: 'account_created' };

export type QueuedEvent = TelemetryEvent & { at: number };

/** Retrato do progresso que vai em cada lote (e com a nota). */
export interface Snapshot {
  lessonsCompleted: number;
  xpTotal: number;
  streak: number;
  currentLessonId: string | null;
  hasAccount: boolean;
  appVersion: string | null;
  lang: Lang;
  platform: Platform;
  installed: Installed;
}

export interface TelemetryBatch {
  v: 1;
  id: string;
  /** Deslocamento do fuso (getTimezoneOffset, em minutos): o servidor tira o dia local de cada evento. */
  tz: number;
  snapshot: Snapshot;
  events: QueuedEvent[];
}

export interface FeedbackPayload {
  id: string;
  rating: number;
  text: string;
  snapshot: Snapshot;
}

export const KEYS = {
  id: 'librax_telemetryId',
  off: 'librax_telemetryOff',
  queue: 'librax_telemetryQueue',
  deletes: 'librax_telemetryDeletes',
  feedback: 'librax_feedbackOutbox',
  feedbackId: 'librax_feedbackId',
} as const;

/** Chaves que não são deste módulo e que o código anônimo nunca pode repetir. */
const OTHER_IDS = ['librax_deviceId', 'librax_userId'];

export const MAX_QUEUE = 200;
export const MAX_BATCH = 40;
/** Códigos esperando a exclusão no servidor (sem rede): poucos, os mais velhos saem. */
const MAX_DELETES = 10;
/** Duração de lição acima disso não é medida (aba esquecida aberta). */
const MAX_LESSON_SEC = 6 * 60 * 60;
export const FEEDBACK_TEXT_MAX = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface TelemetryDeps {
  fetch: typeof fetch;
  sendBeacon: ((url: string, data: Blob) => boolean) | null;
  storage: Store | null;
  apiBase: string;
  now: () => number;
  online: () => boolean;
  onboarded: () => boolean;
  randomId: () => string;
  userAgent: () => string;
}

const defaults = (): TelemetryDeps => ({
  fetch: (...args) => fetch(...args),
  sendBeacon: typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'
    ? (url, data) => navigator.sendBeacon(url, data)
    : null,
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  apiBase: import.meta.env.VITE_API_BASE || '/api',
  now: () => Date.now(),
  online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
  onboarded: isOnboarded,
  randomId: () => crypto.randomUUID(),
  userAgent: () => (typeof navigator === 'undefined' ? '' : navigator.userAgent),
});

let deps: TelemetryDeps = defaults();
let flushing: Promise<FlushOutcome> | null = null;
const lessonStarts = new Map<string, number>();
const listeners = new Set<() => void>();

/** Troca dependências (testes). */
export function configureTelemetry(overrides: Partial<TelemetryDeps>): void {
  deps = { ...deps, ...overrides };
}

// ---------------------------------------------------------------------------
// armazenamento (tudo protegido: sem localStorage, o app segue sem dados de uso)
// ---------------------------------------------------------------------------

function read(key: string): string | null {
  try {
    return deps.storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null) deps.storage?.removeItem(key);
    else deps.storage?.setItem(key, value);
  } catch {
    /* armazenamento cheio ou bloqueado: perde só o dado de uso */
  }
}
function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = read(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const notify = () => listeners.forEach(fn => fn());

/** Avisa quando liga ou desliga (o interruptor das Configurações). */
export function subscribeTelemetry(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------------------
// código anônimo e interruptor
// ---------------------------------------------------------------------------

/** Ligado por padrão; só a escolha "desligar" fica guardada. */
export function isTelemetryEnabled(): boolean {
  return read(KEYS.off) !== '1';
}

/** Um UUID novo que não repete nenhum outro código guardado no aparelho. */
function freshId(): string {
  const others = new Set(OTHER_IDS.map(k => read(k)).filter(Boolean).map(v => String(v).replace(/^usr-/, '')));
  for (;;) {
    const id = deps.randomId();
    if (UUID_RE.test(id) && !others.has(id)) return id;
  }
}

/** Código anônimo deste navegador (criado na primeira vez). */
export function getTelemetryId(): string {
  const saved = read(KEYS.id);
  if (saved && UUID_RE.test(saved)) return saved;
  const id = freshId();
  write(KEYS.id, id);
  return id;
}

function queueDelete(id: string | null): void {
  if (!id || !UUID_RE.test(id)) return;
  const list = readJson<string[]>(KEYS.deletes, []).filter(x => x !== id);
  list.push(id);
  write(KEYS.deletes, JSON.stringify(list.slice(-MAX_DELETES)));
}

/**
 * Liga ou desliga. Desligar apaga a fila e o código deste aparelho e pede ao servidor para apagar
 * a cópia (com nova tentativa depois, se faltar rede). Ligar de novo cria um código novo.
 */
export function setTelemetryEnabled(on: boolean): void {
  if (on) {
    write(KEYS.off, null);
  } else {
    write(KEYS.off, '1');
    queueDelete(read(KEYS.id));
    write(KEYS.id, null);
    write(KEYS.queue, null);
    lessonStarts.clear();
    void processPendingDeletes();
  }
  notify();
}

/**
 * "Excluir conta e dados": antes de limpar o aparelho, marca para apagar no servidor o código dos
 * dados de uso e o da nota (se houver) e já tenta. Devolve a função que regrava, depois do
 * localStorage.clear(), só o que precisa sobreviver: os códigos ainda por apagar e a escolha de
 * deixar os dados de uso desligados.
 */
export function prepareDataReset(): () => void {
  queueDelete(read(KEYS.id));
  queueDelete(read(KEYS.feedbackId));
  const deletes = read(KEYS.deletes);
  const off = read(KEYS.off);
  write(KEYS.id, null);
  write(KEYS.feedbackId, null);
  write(KEYS.queue, null);
  write(KEYS.feedback, null);
  lessonStarts.clear();
  void processPendingDeletes();
  return () => {
    // o que o envio acima já apagou no servidor saiu da lista; o resto fica para a próxima abertura
    const pending = read(KEYS.deletes) ?? deletes;
    if (pending) write(KEYS.deletes, pending);
    if (off) write(KEYS.off, off);
  };
}

/** Tenta apagar no servidor os códigos marcados. Sai da lista o que o servidor confirmou. */
export async function processPendingDeletes(): Promise<number> {
  const ids = readJson<string[]>(KEYS.deletes, []);
  if (ids.length === 0 || !deps.online()) return 0;
  let done = 0;
  for (const id of ids) {
    try {
      const res = await deps.fetch(`${deps.apiBase}/v1/telemetry/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true });
      // 400: código que o servidor não aceita, não adianta repetir
      if (res.ok || res.status === 400 || res.status === 404) {
        done += 1;
        write(KEYS.deletes, JSON.stringify(readJson<string[]>(KEYS.deletes, []).filter(x => x !== id)));
      }
    } catch {
      /* sem rede: fica para a próxima */
    }
  }
  if (readJson<string[]>(KEYS.deletes, []).length === 0) write(KEYS.deletes, null);
  return done;
}

// ---------------------------------------------------------------------------
// retrato do progresso
// ---------------------------------------------------------------------------

/** Plataforma aproximada, tirada aqui (o servidor não guarda o User-Agent). */
export function coarsePlatform(ua = deps.userAgent()): Platform {
  if (/Android/i.test(ua)) return 'android';
  try {
    if (isIos(ua)) return 'ios';
  } catch {
    if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  }
  if (/Windows|Macintosh|Linux|CrOS/i.test(ua)) return 'desktop';
  return 'other';
}

export function installKind(): Installed {
  try {
    if (isTwa()) return 'twa';
    if (isStandalone()) return 'pwa';
  } catch {
    /* sem window */
  }
  return 'browser';
}

/** Versão curta do build: dia e commit (lib/appVersion.ts); null nos testes e no dev. */
export function appVersionTag(): string | null {
  const day = BUILD.builtAt.slice(0, 10);
  const tag = [day, BUILD.commit].filter(Boolean).join('+');
  return tag || null;
}

let progress: Pick<Snapshot, 'lessonsCompleted' | 'xpTotal' | 'streak' | 'currentLessonId'> = {
  lessonsCompleted: 0, xpTotal: 0, streak: 0, currentLessonId: null,
};
let context: { hasAccount: boolean; lang: Lang } = { hasAccount: false, lang: 'pt-BR' };

/** Progresso local do momento (App, ao abrir e ao concluir lição). */
export function setTelemetryProgress(next: Partial<typeof progress>): void {
  progress = { ...progress, ...next };
}

/** Conta conectada (só sim ou não) e idioma do app. */
export function setTelemetryContext(next: Partial<typeof context>): void {
  context = { ...context, ...next };
}

export function currentSnapshot(): Snapshot {
  const int = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)));
  return {
    lessonsCompleted: int(progress.lessonsCompleted, 10000),
    xpTotal: int(progress.xpTotal, 10_000_000),
    streak: int(progress.streak, 100_000),
    currentLessonId: progress.currentLessonId,
    hasAccount: context.hasAccount === true,
    appVersion: appVersionTag(),
    lang: context.lang,
    platform: coarsePlatform(),
    installed: installKind(),
  };
}

// ---------------------------------------------------------------------------
// eventos e envio
// ---------------------------------------------------------------------------

export function pendingEvents(): QueuedEvent[] {
  return readJson<QueuedEvent[]>(KEYS.queue, []);
}

/** Guarda um evento (nada se estiver desligado). Nunca lança. */
export function track(event: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return;
  try {
    const queue = pendingEvents();
    queue.push({ ...event, at: deps.now() });
    write(KEYS.queue, JSON.stringify(queue.slice(-MAX_QUEUE)));
  } catch {
    /* nunca atrapalha a tela */
  }
}

/** Abriu uma lição (marca o início, para a duração). */
export function trackLessonOpen(lessonId: string): void {
  lessonStarts.set(lessonId, deps.now());
  track({ type: 'lesson_open', lessonId });
}

/** Concluiu a lição: nota, XP e a duração desde a abertura (se a lição abriu nesta visita). */
export function trackLessonComplete(lessonId: string, score: number, xp: number): void {
  const started = lessonStarts.get(lessonId);
  lessonStarts.delete(lessonId);
  const sec = started === undefined ? undefined : Math.round((deps.now() - started) / 1000);
  track({
    type: 'lesson_complete',
    lessonId,
    score: Math.max(0, Math.min(1, score)),
    xp: Math.max(0, Math.round(xp)),
    ...(sec !== undefined && sec >= 0 && sec <= MAX_LESSON_SEC ? { durationSec: sec } : {}),
  });
}

export function trackLessonAbandon(lessonId: string, exerciseIndex: number, exerciseCount: number): void {
  lessonStarts.delete(lessonId);
  if (exerciseCount < 1) return;
  track({ type: 'lesson_abandon', lessonId, exerciseIndex: Math.max(0, Math.min(exerciseCount - 1, exerciseIndex)), exerciseCount });
}

export function buildBatch(events: QueuedEvent[]): TelemetryBatch {
  return { v: 1, id: getTelemetryId(), tz: new Date(deps.now()).getTimezoneOffset(), snapshot: currentSnapshot(), events };
}

export type FlushOutcome = 'sent' | 'empty' | 'off' | 'waiting' | 'kept' | 'dropped';

/** Tira da fila os eventos enviados (pelo horário e tipo, na ordem: a fila só cresce no fim). */
function removeSent(sent: QueuedEvent[]): void {
  const queue = pendingEvents();
  let i = 0;
  while (i < sent.length && i < queue.length && queue[i].at === sent[i].at && queue[i].type === sent[i].type) i += 1;
  write(KEYS.queue, i >= queue.length ? null : JSON.stringify(queue.slice(i)));
}

async function flushOnce(beacon: boolean): Promise<FlushOutcome> {
  if (!isTelemetryEnabled()) return 'off';
  if (!deps.onboarded()) return 'waiting';
  const events = pendingEvents().slice(0, MAX_BATCH);
  if (events.length === 0) return 'empty';
  if (!deps.online()) return 'kept';
  const url = `${deps.apiBase}/v1/telemetry`;
  const body = JSON.stringify(buildBatch(events));
  // text/plain: o sendBeacon manda sem pré-voo de CORS; o servidor lê o mesmo JSON
  if (beacon && deps.sendBeacon) {
    try {
      if (deps.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) {
        removeSent(events);
        return 'sent';
      }
    } catch {
      /* cai no fetch */
    }
  }
  try {
    const res = await deps.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
    });
    if (res.ok) {
      removeSent(events);
      return 'sent';
    }
    // conteúdo recusado: reenviar igual não muda nada
    if (res.status === 400 || res.status === 413 || res.status === 422) {
      removeSent(events);
      return 'dropped';
    }
    return 'kept';
  } catch {
    return 'kept';
  }
}

/**
 * Manda o que estiver na fila (um lote por vez; mais um se a fila ainda tiver um lote cheio).
 * `beacon`: o app está saindo da tela (sendBeacon sobrevive ao fechamento).
 */
export function flushTelemetry({ beacon = false }: { beacon?: boolean } = {}): Promise<FlushOutcome> {
  flushing ??= (async () => {
    let outcome = await flushOnce(beacon);
    if (outcome === 'sent' && pendingEvents().length >= MAX_BATCH) outcome = await flushOnce(beacon);
    return outcome;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// ---------------------------------------------------------------------------
// nota do app
// ---------------------------------------------------------------------------

/** Código da nota: o dos dados de uso, ou, com eles desligados, um aleatório só para a nota. */
function feedbackId(): string {
  if (isTelemetryEnabled()) return getTelemetryId();
  const saved = read(KEYS.feedbackId);
  if (saved && UUID_RE.test(saved)) return saved;
  const id = freshId();
  write(KEYS.feedbackId, id);
  return id;
}

/** Texto como a pessoa escreveu, sem caracteres de controle, no limite de tamanho. */
export function cleanFeedbackText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, FEEDBACK_TEXT_MAX);
}

/**
 * Manda a nota (ou guarda para mandar quando houver rede). Uma por código: a nova substitui.
 * @returns 'sent' ou 'queued'
 */
export async function sendFeedback(rating: number, text: string): Promise<'sent' | 'queued'> {
  const payload: FeedbackPayload = {
    id: feedbackId(),
    rating: Math.max(1, Math.min(5, Math.round(rating))),
    text: cleanFeedbackText(text),
    snapshot: currentSnapshot(),
  };
  write(KEYS.feedback, JSON.stringify(payload));
  return (await flushFeedback()) ? 'sent' : 'queued';
}

/** Manda a nota guardada, se houver. */
export async function flushFeedback(): Promise<boolean> {
  const payload = readJson<FeedbackPayload | null>(KEYS.feedback, null);
  if (!payload) return false;
  if (!deps.online()) return false;
  try {
    const res = await deps.fetch(`${deps.apiBase}/v1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (res.ok || res.status === 400 || res.status === 413) {
      write(KEYS.feedback, null);
      return res.ok;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// gatilhos
// ---------------------------------------------------------------------------

/**
 * Liga os gatilhos: apaga o que ficou pendente, manda a nota guardada, registra a abertura e manda
 * a fila quando o app sai da tela, quando a rede volta e na volta ao app depois de horas.
 * Devolve a função que desliga tudo.
 */
export function startTelemetry(): () => void {
  const sendAll = () => {
    void processPendingDeletes().catch(() => {});
    void flushFeedback().catch(() => {});
    void flushTelemetry().catch(() => {});
  };
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushTelemetry({ beacon: true }).catch(() => {});
  };
  const onPageHide = () => {
    void flushTelemetry({ beacon: true }).catch(() => {});
  };
  void processPendingDeletes().catch(() => {});
  void flushFeedback().catch(() => {});
  track({ type: 'app_open' });
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', sendAll);
  const stopReopen = onAppReopen(() => track({ type: 'app_open' }));
  return () => {
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('online', sendAll);
    stopReopen();
  };
}

export function __resetTelemetryForTests(): void {
  deps = defaults();
  flushing = null;
  lessonStarts.clear();
  listeners.clear();
  progress = { lessonsCompleted: 0, xpTotal: 0, streak: 0, currentLessonId: null };
  context = { hasAccount: false, lang: 'pt-BR' };
}
