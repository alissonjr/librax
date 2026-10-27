import { openDB, type IDBPDatabase } from 'idb';
import { getSession, onAuthEvent, type Session } from './auth';
import type { LessonCameraStats } from './cameraStats';

/**
 * Fila offline (outbox) das conclusões de lição: spec-02 seção 7 e plano mobile web, fase W3.
 *
 * - Cada conclusão vira uma entrada no IndexedDB com um `lessonAttemptId` único, que o
 *   servidor usa para não aplicar duas vezes (reenvio, aba duplicada, resposta perdida).
 * - Convidado: as entradas ficam guardadas (owner null). Ao entrar na conta, vão em lote para
 *   POST /v1/guest/migrate, que reexecuta tudo no servidor com o mesmo completeLesson.
 * - Com conta: cada entrada vai para POST /v1/lesson/complete, em ordem.
 * - Envio na abertura do app, no evento `online`, ao voltar para a aba (`visibilitychange`)
 *   e ao entrar na conta (startSync). Background Sync fica como extra, não como base.
 *
 * - Teste de nivelamento (placement.ts): as lições puladas e o "Desfazer" vão pela mesma fila, como
 *   marcas (`placement: 'skip' | 'undo'`, sem nota), na ordem em que aconteceram junto com as
 *   conclusões. O servidor só registra o progresso (sem XP, sequência, SRS, conquista nem liga).
 *
 * O progresso local (IdbRepo) continua sendo a fonte da tela; a fila só leva ao servidor.
 * Banco próprio (`librax-sync`) para não mexer na versão do banco do app (db.ts).
 */

export interface ReviewedSign {
  signId: string;
  result: { state: string; highConfidence?: boolean };
}

/**
 * Respostas e erros por tipo de exercício numa lição (`{ watch_choose_word: { attempted, wrong } }`).
 * Só alimenta os contadores do painel de administração (onde as pessoas mais erram); o servidor
 * descarta o que vier fora do formato sem recusar a conclusão.
 */
export type ExerciseStats = Record<string, { attempted: number; wrong: number }>;

/**
 * Desempenho da câmera produzido na lição (cameraStats.ts, `LessonCameraStats`): acertos, pulos,
 * tentativas e leituras de outro sinal, por sinal. Só a diferença da lição, nunca o acumulado do
 * aparelho; também só alimenta os contadores do painel e o servidor descarta o que vier fora do formato.
 */
export type { LessonCameraStats } from './cameraStats';

export interface LessonCompletionInput {
  lessonId: string;
  /** Dia local da conclusão ('YYYY-MM-DD'), o mesmo passado ao completeLesson local. */
  today: string;
  score: number;
  reviewed?: ReviewedSign[];
  signsLearnedDelta?: number;
  lessonAttemptId?: string;
  completedAt?: string;
  exerciseStats?: ExerciseStats;
  cameraStats?: LessonCameraStats;
}

export interface OutboxEntry {
  lessonAttemptId: string;
  lessonId: string;
  today: string;
  score: number;
  reviewed: ReviewedSign[];
  signsLearnedDelta: number;
  completedAt: string;
  exerciseStats?: ExerciseStats;
  cameraStats?: LessonCameraStats;
  /**
   * Marca do teste de nivelamento em vez de conclusão: 'skip' (lição pulada) ou 'undo' (teste
   * desfeito, lição não refeita). Vai sem nota, revisões nem telemetria (`score` e afins ficam
   * zerados aqui e não são enviados).
   */
  placement?: PlacementMark;
  /** sub do Cognito de quem concluiu; null = convidado (vai pela migração). */
  owner: string | null;
  seq: number;
  attempts: number;
}

export type PlacementMark = 'skip' | 'undo';

export interface SyncResult {
  sent: number;
  dropped: number;
  remaining: number;
  skipped?: 'offline' | 'signed_out';
}

export interface SyncDeps {
  fetch: typeof fetch;
  getSession: () => Promise<Session | null>;
  /** Prefixo da API na mesma origem (CloudFront /api/*). */
  apiBase: string;
  now: () => Date;
}

/** Lote do guest/migrate: metade do limite do servidor (200 conclusões, 256 KB). */
export const MIGRATE_BATCH = 100;

const DB_NAME = 'librax-sync';
const STORE = 'outbox';

const defaults = (): SyncDeps => ({
  fetch: (...args) => fetch(...args),
  getSession,
  apiBase: import.meta.env.VITE_API_BASE || '/api',
  now: () => new Date(),
});

let deps: SyncDeps = defaults();
let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;
let running: Promise<SyncResult> | null = null;
let seqCounter = 0;

/** Troca dependências (testes, ou outra base de API). */
export function configureSync(overrides: Partial<SyncDeps>): void {
  deps = { ...deps, ...overrides };
}

function db() {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(d) {
      const store = d.createObjectStore(STORE, { keyPath: 'lessonAttemptId' });
      store.createIndex('bySeq', 'seq');
    },
  });
  return dbPromise;
}

/** Guarda uma conclusão na fila. Chamar logo depois do completeLesson local. */
export async function enqueueLessonCompletion(input: LessonCompletionInput): Promise<OutboxEntry> {
  const session = await deps.getSession();
  const d = await db();
  const id = input.lessonAttemptId ?? crypto.randomUUID();
  const existing = (await d.get(STORE, id)) as OutboxEntry | undefined;
  if (existing) return existing;

  const entry: OutboxEntry = {
    lessonAttemptId: id,
    lessonId: input.lessonId,
    today: input.today,
    score: input.score,
    reviewed: input.reviewed ?? [],
    signsLearnedDelta: input.signsLearnedDelta ?? 0,
    completedAt: input.completedAt ?? deps.now().toISOString(),
    ...(input.exerciseStats && Object.keys(input.exerciseStats).length ? { exerciseStats: input.exerciseStats } : {}),
    ...(input.cameraStats && Object.keys(input.cameraStats).length ? { cameraStats: input.cameraStats } : {}),
    owner: session?.userId ?? null,
    seq: Date.now() * 1000 + (seqCounter++ % 1000),
    attempts: 0,
  };
  await d.put(STORE, entry);
  return entry;
}

/**
 * Guarda as marcas do teste de nivelamento na fila, uma por lição (cada uma com o próprio id de
 * tentativa, para o servidor não aplicar duas vezes). Chamar logo depois de gravar no aparelho.
 */
export async function enqueuePlacementMarks(lessonIds: string[], placement: PlacementMark, today: string): Promise<OutboxEntry[]> {
  if (lessonIds.length === 0) return [];
  const session = await deps.getSession();
  const d = await db();
  const completedAt = deps.now().toISOString();
  const entries = lessonIds.map((lessonId): OutboxEntry => ({
    lessonAttemptId: crypto.randomUUID(),
    lessonId,
    today,
    score: 0,
    reviewed: [],
    signsLearnedDelta: 0,
    completedAt,
    placement,
    owner: session?.userId ?? null,
    seq: Date.now() * 1000 + (seqCounter++ % 1000),
    attempts: 0,
  }));
  const tx = d.transaction(STORE, 'readwrite');
  await Promise.all([...entries.map((e) => tx.store.put(e)), tx.done]);
  return entries;
}

/** Entradas ainda não confirmadas pelo servidor, na ordem em que foram concluídas. */
export async function pendingEntries(): Promise<OutboxEntry[]> {
  return (await (await db()).getAllFromIndex(STORE, 'bySeq')) as OutboxEntry[];
}

/** Esvazia a fila (sair da conta com "apagar dados", exclusão LGPD, testes). */
export async function clearOutbox(): Promise<void> {
  await (await db()).clear(STORE);
}

const toPayload = (e: OutboxEntry) => e.placement ? {
  // sem `score`: um servidor que ainda não conhece a marca recusa (400) em vez de dar XP
  lessonAttemptId: e.lessonAttemptId,
  lessonId: e.lessonId,
  today: e.today,
  completedAt: e.completedAt,
  placement: e.placement,
} : ({
  lessonAttemptId: e.lessonAttemptId,
  lessonId: e.lessonId,
  today: e.today,
  score: e.score,
  completedAt: e.completedAt,
  reviewed: e.reviewed,
  signsLearnedDelta: e.signsLearnedDelta,
  ...(e.exerciseStats ? { exerciseStats: e.exerciseStats } : {}),
  ...(e.cameraStats ? { cameraStats: e.cameraStats } : {}),
});

type Outcome = 'ok' | 'drop' | 'auth' | 'retry' | 'too_large';

async function post(path: string, token: string, body: unknown): Promise<{ outcome: Outcome; data: unknown }> {
  try {
    const res = await deps.fetch(`${deps.apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return { outcome: 'ok', data: await res.json().catch(() => null) };
    if (res.status === 401 || res.status === 403) return { outcome: 'auth', data: null };
    if (res.status === 413) return { outcome: 'too_large', data: null };
    // 400/404/409/422: o servidor recusou o conteúdo; reenviar igual não muda nada
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      return { outcome: 'drop', data: null };
    }
    return { outcome: 'retry', data: null };
  } catch {
    return { outcome: 'retry', data: null };
  }
}

async function remove(ids: string[]) {
  const d = await db();
  const tx = d.transaction(STORE, 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

async function bumpAttempts(entry: OutboxEntry) {
  await (await db()).put(STORE, { ...entry, attempts: entry.attempts + 1 });
}

interface Tally {
  sent: number;
  dropped: number;
  stop?: 'auth' | 'retry';
}

/** Manda um lote ao guest/migrate; em 413 divide ao meio. */
async function migrateBatch(batch: OutboxEntry[], token: string, tally: Tally): Promise<void> {
  const { outcome, data } = await post('/v1/guest/migrate', token, { entries: batch.map(toPayload) });
  if (outcome === 'too_large' && batch.length > 1) {
    const half = Math.ceil(batch.length / 2);
    await migrateBatch(batch.slice(0, half), token, tally);
    if (!tally.stop) await migrateBatch(batch.slice(half), token, tally);
    return;
  }
  if (outcome === 'drop' || outcome === 'too_large') {
    // lote recusado inteiro: só descarta quando é uma conclusão sozinha
    if (batch.length === 1) {
      await remove([batch[0].lessonAttemptId]);
      tally.dropped += 1;
    } else {
      const half = Math.ceil(batch.length / 2);
      await migrateBatch(batch.slice(0, half), token, tally);
      if (!tally.stop) await migrateBatch(batch.slice(half), token, tally);
    }
    return;
  }
  if (outcome !== 'ok') {
    tally.stop = outcome;
    if (outcome === 'retry') await bumpAttempts(batch[0]);
    return;
  }

  const results = ((data as { results?: { lessonAttemptId: string | null; status: string }[] } | null)?.results ?? []);
  const inBatch = new Set(batch.map((e) => e.lessonAttemptId));
  const answered = results.filter((r) => r.lessonAttemptId && inBatch.has(r.lessonAttemptId));
  await remove(answered.map((r) => r.lessonAttemptId as string));
  for (const r of answered) {
    if (r.status === 'rejected') tally.dropped += 1;
    else tally.sent += 1;
  }
}

async function runMigration(session: Session, tally: Tally): Promise<void> {
  const guestEntries = (await pendingEntries()).filter((e) => e.owner === null);
  for (let i = 0; i < guestEntries.length && !tally.stop; i += MIGRATE_BATCH) {
    await migrateBatch(guestEntries.slice(i, i + MIGRATE_BATCH), session.token, tally);
  }
}

async function runCompletions(session: Session, tally: Tally): Promise<void> {
  const mine = (await pendingEntries()).filter((e) => e.owner === session.userId);
  for (const entry of mine) {
    const { outcome } = await post('/v1/lesson/complete', session.token, toPayload(entry));
    if (outcome === 'ok') {
      await remove([entry.lessonAttemptId]);
      tally.sent += 1;
    } else if (outcome === 'drop' || outcome === 'too_large') {
      await remove([entry.lessonAttemptId]);
      tally.dropped += 1;
    } else {
      // para na primeira falha: a ofensiva depende da ordem dos dias
      if (outcome === 'retry') await bumpAttempts(entry);
      tally.stop = outcome;
      return;
    }
  }
}

async function finish(tally: Tally): Promise<SyncResult> {
  const result: SyncResult = { sent: tally.sent, dropped: tally.dropped, remaining: (await pendingEntries()).length };
  if (tally.stop === 'auth') result.skipped = 'signed_out';
  return result;
}

function singleFlight(fn: () => Promise<SyncResult>): Promise<SyncResult> {
  running ??= fn().finally(() => {
    running = null;
  });
  return running;
}

async function precheck(): Promise<Session | SyncResult> {
  const remaining = async () => (await pendingEntries()).length;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { sent: 0, dropped: 0, remaining: await remaining(), skipped: 'offline' };
  }
  const session = await deps.getSession();
  if (!session) return { sent: 0, dropped: 0, remaining: await remaining(), skipped: 'signed_out' };
  return session;
}

const isSession = (v: Session | SyncResult): v is Session => 'token' in v;

/**
 * Manda o log do convidado para POST /v1/guest/migrate. Chamar logo depois de criar a conta
 * ou entrar (startSync já faz isso pelo evento de login).
 */
export function migrateGuest(): Promise<SyncResult> {
  return singleFlight(async () => {
    const pre = await precheck();
    if (!isSession(pre)) return pre;
    const tally: Tally = { sent: 0, dropped: 0 };
    await runMigration(pre, tally);
    return finish(tally);
  });
}

/** Envia tudo o que der: primeiro o que sobrou do convidado, depois as conclusões da conta. */
export function flushOutbox(): Promise<SyncResult> {
  return singleFlight(async () => {
    const pre = await precheck();
    if (!isSession(pre)) return pre;
    const tally: Tally = { sent: 0, dropped: 0 };
    await runMigration(pre, tally);
    if (!tally.stop) await runCompletions(pre, tally);
    return finish(tally);
  });
}

export interface LessonAbandonInput {
  lessonId: string;
  /** Dia local ('YYYY-MM-DD'), o mesmo das conclusões. */
  today: string;
  /** Exercício em que a pessoa parou (o próximo a abrir) e quantos a lição tem. */
  exerciseIndex: number;
  exerciseCount: number;
  exerciseType: string | null;
}

/**
 * Avisa o servidor que a pessoa saiu da lição no meio (POST /v1/lesson/abandon), para o painel
 * de administração mostrar onde as pessoas desistem. É só contagem: sem conta, sem rede ou com
 * erro, não manda nada e nada é guardado para depois (não vale uma fila).
 */
export async function reportLessonAbandon(input: LessonAbandonInput): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
    const session = await deps.getSession();
    if (!session) return false;
    const res = await deps.fetch(`${deps.apiBase}/v1/lesson/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify(input),
      keepalive: true, // a tela está saindo da lição
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Progresso da conta (GET /v1/users/me/progress; services/api usecases/exportProgress.js). */
export interface AccountProgress {
  profile: {
    displayName: string | null;
    xpTotal: number;
    streak: number;
    lastActiveDay: string | null;
    freezes: number;
    signsLearned: number;
    lessonsCompleted: number;
    alphabetComplete: boolean;
  };
  /** `placement`: pulada pelo teste de nivelamento (no aparelho, concluída com `placement: true`). */
  lessons: { lessonId: string; status: 'completed' | 'placement'; bestScore?: number | null; completedAt: string | null }[];
  srs: ({ signId: string } & Record<string, unknown>)[];
  days: { day: string; xp: number }[];
  achievements: string[];
}

/** Espera do progresso da conta: passou disso, a pessoa entra sem ele (o mapa fica como está). */
export const ACCOUNT_PROGRESS_TIMEOUT_MS = 10_000;

/**
 * Busca o progresso da conta. Antes, espera a fila sair (o log do convidado entra na conta), para a
 * resposta já trazer o que foi feito neste aparelho. Sem conta, sem rede ou com erro: null.
 */
export async function fetchAccountProgress(): Promise<AccountProgress | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;
  await flushOutbox().catch(() => {});
  const session = await deps.getSession();
  if (!session) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ACCOUNT_PROGRESS_TIMEOUT_MS);
  try {
    const res = await deps.fetch(`${deps.apiBase}/v1/users/me/progress`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AccountProgress;
    return data && typeof data === 'object' && data.profile && Array.isArray(data.lessons) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resultado da exclusão no servidor; só `deleted` libera a limpeza do aparelho. */
export type DeleteAccountOutcome = 'deleted' | 'offline' | 'error';

/**
 * Exclui a conta no servidor (DELETE /v1/users/me): squads, ligas, os dados da conta e o login
 * no Cognito. Chamar antes de limpar o aparelho: sem rede, sem sessão ou com erro do servidor,
 * nada foi apagado e a pessoa pode tentar de novo (a rota é idempotente). Espera um envio da
 * fila que já esteja no meio, para uma conclusão não chegar depois da exclusão.
 */
export async function deleteAccountOnServer(): Promise<DeleteAccountOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  await running?.catch(() => {});
  const session = await deps.getSession();
  // com conta na tela e sem sessão: o token não renovou (rede ou sessão vencida)
  if (!session) return 'error';
  try {
    const res = await deps.fetch(`${deps.apiBase}/v1/users/me`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    return res.ok ? 'deleted' : 'error';
  } catch {
    return 'offline';
  }
}

/**
 * Liga os gatilhos de envio: agora (abertura do app), `online`, aba visível e login.
 * Devolve a função que desliga tudo.
 */
export function startSync(): () => void {
  const run = () => {
    void flushOutbox().catch(() => {});
  };
  const onVisible = () => {
    if (document.visibilityState === 'visible') run();
  };
  let stopAuth: (() => void) | null = null;
  let stopped = false;

  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', onVisible);
  onAuthEvent((event) => {
    if (event === 'signedIn') run();
  })
    .then((stop) => {
      if (stopped) stop();
      else stopAuth = stop;
    })
    .catch(() => {});
  run();

  return () => {
    stopped = true;
    window.removeEventListener('online', run);
    document.removeEventListener('visibilitychange', onVisible);
    stopAuth?.();
  };
}

export function __resetSyncForTests(): void {
  deps = defaults();
  running = null;
}
