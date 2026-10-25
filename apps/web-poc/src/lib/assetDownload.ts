import { useSyncExternalStore } from 'react';
import {
  CLASSIFIER_DIR, HAND_MODEL_URL, LETTER_MOTION_DIR, MEDIAPIPE_WASM_DIR, POSE_MODEL_URL, SIGN_MODEL_DIR,
} from '../recognition/mlAssets';
import { whenSplashDone } from './splash';

/**
 * Arquivos grandes baixados em segundo plano, sem nunca atrasar a abertura (plano mobile web 3.5:
 * nada pesado no carregamento inicial).
 *
 * - O service worker já guarda /ml/ e /vlibras/ quando são pedidos (CacheFirst no vite.config.ts).
 *   Aqui o app só pede os mesmos endereços com fetch e lê o corpo até o fim: a cópia que o service
 *   worker guarda é a mesma que a câmera e o avatar vão pedir depois, e funciona offline.
 * - Câmera: depois que a abertura terminou e o app ficou ocioso, se a conexão parece boa (sem
 *   economia de dados nem 2g). O progresso aparece num selo discreto no mapa.
 * - Tudo (câmera e avatar VLibras): pela opção "Baixar para usar offline" das Configurações
 *   (lib/offlinePack.ts monta a lista).
 * O que já está no cache não é baixado de novo. Sem service worker controlando a página (servidor
 * de desenvolvimento, navegador sem suporte) não há onde guardar, então nada é baixado.
 */

export interface AssetFile {
  url: string;
  /** Tamanho esperado, para o progresso antes de o Content-Length chegar e para a estimativa em MB. */
  bytes: number;
  /** Pode não existir (classificador ainda não treinado): falhar não estraga o resto. */
  optional?: boolean;
}

/* ---------- câmera ---------- */

/**
 * O FilesetResolver do MediaPipe escolhe o WASM com SIMD quando este módulo mínimo compila (os mesmos
 * bytes do vision_bundle); os navegadores-alvo têm SIMD, o outro fica para aparelho antigo.
 */
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

export async function simdSupported(): Promise<boolean> {
  try {
    await WebAssembly.instantiate(SIMD_PROBE);
    return true;
  } catch {
    return false;
  }
}

/**
 * Arquivos da câmera, nos endereços que o landmarker.ts e o classifier.ts pedem. Tamanhos da versão
 * fixada em mlAssets.ts (o teste assetDownload.test.ts confere quando public/ml/ existe).
 * Com `signs` (há modelo de sinais publicado, ver signModel.ts), também o modelo do corpo e o dos
 * sinais com movimento; sem ele, nada disso é baixado.
 */
export function cameraFiles(simd: boolean, signs = false): AssetFile[] {
  const wasm = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  const files: AssetFile[] = [
    { url: `${MEDIAPIPE_WASM_DIR}/${wasm}.js`, bytes: simd ? 334_128 : 333_931 },
    { url: `${MEDIAPIPE_WASM_DIR}/${wasm}.wasm`, bytes: simd ? 13_519_922 : 12_627_509 },
    { url: HAND_MODEL_URL, bytes: 7_819_105 },
    { url: `${CLASSIFIER_DIR}/model.json`, bytes: 1_000, optional: true },
    { url: `${CLASSIFIER_DIR}/weights.bin`, bytes: 75_000, optional: true },
    // Letras com movimento: só as mãos (sem o modelo do corpo), opcional como o classificador
    { url: `${LETTER_MOTION_DIR}/model.json`, bytes: 1_000, optional: true },
    { url: `${LETTER_MOTION_DIR}/weights.bin`, bytes: 318_000, optional: true },
  ];
  if (signs) {
    files.push(
      { url: POSE_MODEL_URL, bytes: 5_777_746 },
      // O tamanho dos pesos muda com o número de glosas: é só a estimativa até o Content-Length
      { url: `${SIGN_MODEL_DIR}/model.json`, bytes: 1_000, optional: true },
      { url: `${SIGN_MODEL_DIR}/weights.bin`, bytes: 1_300_000, optional: true },
    );
  }
  return files;
}

/** Há modelo de sinais publicado? (lê o model.json uma vez por sessão; módulo carregado só aqui) */
export async function signModelPublished(): Promise<boolean> {
  const { loadSignIndex } = await import('../recognition/signModel');
  return (await loadSignIndex()).size > 0;
}

/* ---------- conexão ---------- */

export interface ConnectionInfo {
  saveData?: boolean;
  effectiveType?: string;
}

function connection(): ConnectionInfo | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: ConnectionInfo }).connection;
}

/**
 * Baixar sozinho, sem a pessoa pedir? Não com economia de dados ligada nem em conexão lenta (2g).
 * Sem a API (Safari, Firefox) não há como saber: baixa.
 */
export function shouldPrefetch(conn: ConnectionInfo | undefined): boolean {
  if (!conn) return true;
  if (conn.saveData) return false;
  return conn.effectiveType !== '2g' && conn.effectiveType !== 'slow-2g';
}

/* ---------- download com progresso ---------- */

export interface FileProgress {
  loaded: number;
  total: number;
}

/** Fração baixada (0 a 1) somando os arquivos; arquivo com Content-Length menor que o lido não passa de 100%. */
export function downloadProgress(files: readonly FileProgress[]): number {
  let loaded = 0;
  let total = 0;
  for (const f of files) {
    loaded += Math.min(f.loaded, f.total);
    total += f.total;
  }
  return total > 0 ? loaded / total : 1;
}

export class DownloadError extends Error {
  constructor(readonly url: string, reason: string) {
    super(`${url}: ${reason}`);
  }
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  /** Já está no cache do service worker? Padrão: caches.match. */
  isCached?: (url: string) => Promise<boolean>;
  signal?: AbortSignal;
  /** Downloads ao mesmo tempo (os grandes vêm primeiro na lista e as animações são muitas e pequenas). */
  concurrency?: number;
  onProgress?: (p: { loaded: number; total: number }) => void;
}

export async function isCachedInSw(url: string): Promise<boolean> {
  try {
    return typeof caches !== 'undefined' && !!(await caches.match(url));
  } catch {
    return false;
  }
}

/** O que falta baixar (o resto já está no cache). */
export async function missingFiles(files: readonly AssetFile[], isCached = isCachedInSw): Promise<AssetFile[]> {
  const cached = await Promise.all(files.map(f => isCached(f.url)));
  return files.filter((_, i) => !cached[i]);
}

/** Resposta que não é o arquivo: erro HTTP ou o index.html que o servidor devolve para arquivo inexistente. */
function badResponse(res: Response, url: string): string | null {
  if (!res.ok) return `HTTP ${res.status}`;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html') && !url.endsWith('.html')) return 'veio o index.html';
  return null;
}

/**
 * Baixa os arquivos que ainda não estão no cache, lendo o corpo em stream para medir o progresso
 * (bytes lidos sobre o Content-Length, ou o tamanho esperado quando ele não vem). Os que já estão
 * guardados contam como prontos. Lança DownloadError no primeiro arquivo obrigatório que falhar,
 * e aí os outros downloads param (nenhum progresso chega depois do erro).
 */
export async function downloadFiles(files: readonly AssetFile[], opts: DownloadOptions = {}): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const isCached = opts.isCached ?? isCachedInSw;
  const progress: FileProgress[] = files.map(f => ({ loaded: 0, total: f.bytes }));
  // Para tudo quando quem chamou cancela ou quando um arquivo obrigatório falha
  const stop = new AbortController();
  if (opts.signal?.aborted) stop.abort();
  opts.signal?.addEventListener('abort', () => stop.abort(), { once: true });
  const report = () => {
    if (stop.signal.aborted) return;
    const total = progress.reduce((s, p) => s + p.total, 0);
    opts.onProgress?.({ loaded: Math.round(downloadProgress(progress) * total), total });
  };

  const cached = await Promise.all(files.map(f => isCached(f.url)));
  cached.forEach((c, i) => { if (c) progress[i].loaded = progress[i].total; });
  report();

  const queue = files.map((_, i) => i).filter(i => !cached[i]);
  const worker = async () => {
    for (let i = queue.shift(); i !== undefined && !stop.signal.aborted; i = queue.shift()) {
      const file = files[i];
      const p = progress[i];
      try {
        const res = await fetchImpl(file.url, { signal: stop.signal, credentials: 'same-origin' });
        const bad = badResponse(res, file.url);
        if (bad) {
          await res.body?.cancel().catch(() => {});
          throw new DownloadError(file.url, bad);
        }
        const length = Number(res.headers.get('content-length'));
        if (length > 0) p.total = length;
        report();
        if (res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            p.loaded += value.byteLength;
            report();
          }
        } else {
          await res.arrayBuffer();
        }
        p.loaded = p.total;
        report();
      } catch (err) {
        if (stop.signal.aborted) throw err;
        if (!file.optional) {
          stop.abort();
          throw err instanceof DownloadError ? err : new DownloadError(file.url, String(err));
        }
        // Opcional que não veio: sai da conta
        p.loaded = p.total;
        report();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 1) }, worker));
  if (opts.signal?.aborted) throw new DownloadError('', 'cancelado');
}

/* ---------- estado para as telas ---------- */

export type DownloadJob = 'camera' | 'offline';
export type DownloadStatus = 'idle' | 'checking' | 'downloading' | 'done' | 'error';
export type DownloadErrorReason = 'offline' | 'unsupported' | 'failed';

export interface DownloadState {
  status: DownloadStatus;
  /** Bytes já guardados (contando o que estava no cache) e o total, para a porcentagem e os MB. */
  loaded: number;
  total: number;
  error: DownloadErrorReason | null;
}

const IDLE: DownloadState = { status: 'idle', loaded: 0, total: 0, error: null };
const states: Record<DownloadJob, DownloadState> = { camera: IDLE, offline: IDLE };
const listeners: Record<DownloadJob, Set<() => void>> = { camera: new Set(), offline: new Set() };
const controllers: Partial<Record<DownloadJob, AbortController>> = {};

function setJob(job: DownloadJob, patch: Partial<DownloadState>) {
  states[job] = { ...states[job], ...patch };
  listeners[job].forEach(l => l());
}

export function getDownloadState(job: DownloadJob): DownloadState {
  return states[job];
}

export function subscribeDownload(job: DownloadJob, listener: () => void): () => void {
  listeners[job].add(listener);
  return () => listeners[job].delete(listener);
}

export function useDownload(job: DownloadJob): DownloadState {
  return useSyncExternalStore(
    l => subscribeDownload(job, l),
    () => getDownloadState(job),
    () => getDownloadState(job),
  );
}

/** Porcentagem inteira (0 a 100) do estado. */
export function downloadPercent(state: DownloadState): number {
  return state.total > 0 ? Math.min(100, Math.floor((state.loaded / state.total) * 100)) : 0;
}

/** Há um service worker controlando a página para guardar o que for baixado? */
export function canStoreOffline(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller && typeof caches !== 'undefined';
}

const sumBytes = (files: readonly AssetFile[]) => files.reduce((s, f) => s + f.bytes, 0);

/**
 * Marca de download concluído por job, com a assinatura da lista (muda quando o curso ganha glosa
 * ou a versão dos arquivos muda). Serve para não insistir nos opcionais que o servidor não tem.
 */
const markKey = (job: DownloadJob) => `librax_download_${job}`;
const signature = (files: readonly AssetFile[]) => `${files.length}:${sumBytes(files)}`;

function isMarked(job: DownloadJob, files: readonly AssetFile[]): boolean {
  try {
    return localStorage.getItem(markKey(job)) === signature(files);
  } catch {
    return false;
  }
}

function mark(job: DownloadJob, files: readonly AssetFile[]) {
  try {
    localStorage.setItem(markKey(job), signature(files));
  } catch {
    /* sem marca: na próxima vez só confere o cache de novo */
  }
}

/**
 * Está tudo guardado? Tudo no cache; ou só faltam opcionais (classificador ainda não publicado,
 * animação que o servidor não tem) e esta lista já foi baixada até o fim antes. Obrigatório fora
 * do cache (o navegador apagou, por exemplo) sempre conta como faltando.
 */
async function storedState(job: DownloadJob, files: readonly AssetFile[], isCached?: (url: string) => Promise<boolean>) {
  const missing = await missingFiles(files, isCached);
  const complete = missing.length === 0 || (missing.every(f => f.optional) && isMarked(job, files));
  return { complete, missing };
}

/**
 * Confere o que já está guardado, sem baixar: completo vira "done"; senão fica "idle" com o que
 * falta em total - loaded (para a estimativa em MB).
 */
export async function checkDownload(job: DownloadJob, files: readonly AssetFile[], isCached = isCachedInSw): Promise<void> {
  // Download em andamento: o estado já está certo
  if (controllers[job]) return;
  setJob(job, { status: 'checking', error: null });
  const { complete, missing } = await storedState(job, files, isCached);
  const total = sumBytes(files);
  setJob(job, complete
    ? { status: 'done', loaded: total, total }
    : { status: 'idle', loaded: total - sumBytes(missing), total });
}

/**
 * Baixa a lista e acompanha o estado do job. Só um download por job; o das Configurações
 * cancela o da câmera em segundo plano (os arquivos dela estão na lista completa).
 */
export async function runDownload(job: DownloadJob, files: readonly AssetFile[], opts: Omit<DownloadOptions, 'signal' | 'onProgress'> = {}): Promise<void> {
  if (controllers[job]) return;
  if (!canStoreOffline()) {
    setJob(job, { status: 'error', error: 'unsupported' });
    return;
  }
  if (job === 'offline') controllers.camera?.abort();
  const controller = new AbortController();
  controllers[job] = controller;
  const total = sumBytes(files);
  setJob(job, { status: 'checking', error: null, loaded: 0, total });
  let lastPct = -1;
  try {
    // Tudo guardado: pronto, sem passar por "baixando" (o selo do mapa nem aparece)
    if ((await storedState(job, files, opts.isCached)).complete) {
      setJob(job, { status: 'done', loaded: total, total });
      return;
    }
    await downloadFiles(files, {
      concurrency: 4,
      ...opts,
      signal: controller.signal,
      onProgress: ({ loaded, total }) => {
        // Avisa as telas só quando a porcentagem muda (o stream chega em pedaços de poucos KB)
        const pct = Math.floor((loaded / (total || 1)) * 100);
        if (pct === lastPct && states[job].status === 'downloading') return;
        lastPct = pct;
        setJob(job, { status: 'downloading', loaded, total });
      },
    });
    mark(job, files);
    setJob(job, { status: 'done', loaded: states[job].total, error: null });
  } catch {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    setJob(job, controller.signal.aborted ? { status: 'idle' } : { status: 'error', error: offline ? 'offline' : 'failed' });
  } finally {
    if (controllers[job] === controller) delete controllers[job];
  }
}

/* ---------- câmera em segundo plano ---------- */

/** Depois da abertura, espera a primeira tela terminar os próprios pedidos antes de começar. */
const PREFETCH_DELAY_MS = 3000;
/** Primeira visita: o service worker instala e assume a página logo depois (clientsClaim). */
const SW_WAIT_MS = 15_000;

let scheduled = false;

function swControlling(): Promise<boolean> {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (!sw || typeof caches === 'undefined') return Promise.resolve(false);
  if (sw.controller) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), SW_WAIT_MS);
    sw.addEventListener('controllerchange', () => { clearTimeout(timer); resolve(!!sw.controller); }, { once: true });
  });
}

function idle(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      // Safari antigo não tem requestIdleCallback: segue depois da espera
      if ('requestIdleCallback' in window) window.requestIdleCallback(() => resolve(), { timeout: 5000 });
      else resolve();
    }, PREFETCH_DELAY_MS);
  });
}

/**
 * Baixa a câmera em segundo plano uma vez por sessão: depois da abertura, com o app ocioso, com
 * service worker para guardar e se a conexão parecer adequada (conferida de novo na hora).
 */
export function scheduleCameraPrefetch(): void {
  if (scheduled) return;
  scheduled = true;
  void (async () => {
    await whenSplashDone();
    if (!shouldPrefetch(connection())) return;
    if (!(await swControlling())) return;
    await idle();
    // A pessoa já pediu tudo nas Configurações: aquele download inclui a câmera
    if (!shouldPrefetch(connection()) || controllers.offline) return;
    const [simd, signs] = await Promise.all([simdSupported(), signModelPublished()]);
    await runDownload('camera', cameraFiles(simd, signs));
  })();
}

/** Só para testes. */
export function __resetDownloadsForTests(): void {
  scheduled = false;
  (Object.keys(states) as DownloadJob[]).forEach(job => {
    controllers[job]?.abort();
    delete controllers[job];
    states[job] = IDLE;
    listeners[job].clear();
  });
}
