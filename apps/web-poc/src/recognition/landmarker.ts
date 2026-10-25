import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';
import { HAND_MODEL_URL, MEDIAPIPE_WASM_DIR } from './mlAssets';

/**
 * HandLandmarker único por sessão do app (seção 3.1 do plano mobile web).
 *
 * Carregar o WASM (13 MB) e o modelo (7,8 MB) e compilar os shaders custa segundos no celular,
 * então o landmarker é criado uma vez, sob demanda (`warmUpHandLandmarker` ao entrar numa tela
 * com câmera), e reaproveitado por todos os exercícios. Fechar a câmera não fecha o landmarker.
 * Só a página de teste recria, para trocar o delegate.
 *
 * As letras usam uma mão; os sinais com movimento, duas. Em vez de um segundo landmarker (mais
 * memória e outra compilação na GPU), o mesmo troca o numHands com setOptions quando quem pede
 * precisa de outro valor. Quem não passa nada recebe sempre uma mão, como antes.
 */

export type Delegate = 'GPU' | 'CPU';

export interface LandmarkerLoad {
  /** Primeira carga da página ('cold') ou recriação com WASM e modelo já baixados ('warm'). */
  kind: 'cold' | 'warm';
  requested: Delegate;
  /** Delegate em uso: GPU (WebGL2) cai para CPU se a criação falhar. */
  delegate: Delegate;
  /** Momento do início, em performance.now(). */
  startedAt: number;
  /** import() do pacote JS do MediaPipe. */
  importMs: number;
  /** createFromOptions: baixar e compilar o WASM, baixar o modelo e montar o grafo. */
  createMs: number;
  /** Erro da tentativa com GPU, quando caiu para CPU. */
  gpuError?: string;
}

export interface LandmarkerHandle {
  landmarker: HandLandmarker;
  delegate: Delegate;
  load: LandmarkerLoad;
  /** Quantas mãos o landmarker procura agora (troca com getHandLandmarker(numHands)). */
  numHands: number;
}

export interface Detection {
  result: HandLandmarkerResult;
  /** Duração do detectForVideo, em ms. */
  ms: number;
}

let pending: Promise<LandmarkerHandle> | null = null;
let ready: LandmarkerHandle | null = null;
let loads = 0;
let preferred: Delegate = 'GPU';
let lastTimestamp = 0;
/** Trocas de numHands em fila: duas telas pedindo valores diferentes não se atropelam. */
let configuring: Promise<unknown> = Promise.resolve();

async function create(delegate: Delegate): Promise<LandmarkerHandle> {
  const startedAt = performance.now();
  const kind = loads === 0 ? 'cold' : 'warm';
  loads += 1;

  const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const importMs = performance.now() - startedAt;

  const tCreate = performance.now();
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_DIR);
  const build = (d: Delegate) =>
    HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: d },
      runningMode: 'VIDEO',
      numHands: 1,
    });

  let landmarker: HandLandmarker;
  let actual = delegate;
  let gpuError: string | undefined;
  try {
    landmarker = await build(delegate);
  } catch (err) {
    if (delegate !== 'GPU') throw err;
    // Sem WebGL2 utilizável: segue na CPU (decisão 6: não depender de GPU nem de WebGPU)
    gpuError = err instanceof Error ? err.message : String(err);
    actual = 'CPU';
    landmarker = await build('CPU');
  }
  const createMs = performance.now() - tCreate;

  return {
    landmarker,
    delegate: actual,
    load: { kind, requested: delegate, delegate: actual, startedAt, importMs, createMs, gpuError },
    numHands: 1,
  };
}

function track(promise: Promise<LandmarkerHandle>): Promise<LandmarkerHandle> {
  pending = promise;
  promise.then(
    (handle) => { if (pending === promise) ready = handle; },
    () => { if (pending === promise) pending = null; }, // falhou: a próxima chamada tenta de novo
  );
  return promise;
}

/**
 * Landmarker da sessão; cria na primeira chamada e devolve o mesmo depois, procurando `numHands`
 * mãos (1 por padrão: as letras).
 */
export function getHandLandmarker(numHands = 1): Promise<LandmarkerHandle> {
  const handle = pending ?? track(create(preferred));
  // Sempre pela fila: um pedido de outro valor ainda em andamento não passa na frente
  return handle.then(h => setNumHands(h, numHands));
}

function setNumHands(handle: LandmarkerHandle, numHands: number): Promise<LandmarkerHandle> {
  const next = configuring.catch(() => {}).then(async () => {
    if (handle.numHands !== numHands) {
      await handle.landmarker.setOptions({ numHands });
      handle.numHands = numHands;
    }
    return handle;
  });
  configuring = next;
  return next;
}

/** Começa a carregar sem esperar (ao entrar numa lição ou tela com câmera). */
export function warmUpHandLandmarker(): void {
  // Só cria: não mexe no numHands (o efeito do exercício de sinal roda antes do da lição e já
  // pode ter pedido duas mãos)
  (pending ?? track(create(preferred))).catch(() => { /* quem usar de fato trata o erro */ });
}

/** O landmarker já pronto, sem esperar. Null enquanto carrega. */
export function peekHandLandmarker(): LandmarkerHandle | null {
  return ready;
}

/** Fecha o atual e cria outro com o delegate pedido (página de teste e calibração). */
export function recreateHandLandmarker(delegate: Delegate): Promise<LandmarkerHandle> {
  preferred = delegate;
  const previous = pending;
  ready = null;
  return track((async () => {
    const old = await previous?.catch(() => null);
    old?.landmarker.close();
    return create(delegate);
  })());
}

/**
 * Detecta a mão no quadro atual do vídeo. O MediaPipe exige timestamps sempre crescentes
 * durante toda a vida do landmarker, mesmo trocando de vídeo; por isso o relógio é único aqui.
 */
export function detectHands(handle: LandmarkerHandle, video: HTMLVideoElement): Detection {
  const timestamp = Math.max(performance.now(), lastTimestamp + 1);
  lastTimestamp = timestamp;
  const t0 = performance.now();
  const result = handle.landmarker.detectForVideo(video, timestamp);
  return { result, ms: performance.now() - t0 };
}

/** Só para testes: esquece o landmarker da sessão. */
export function resetHandLandmarkerForTests(): void {
  pending = null;
  ready = null;
  loads = 0;
  preferred = 'GPU';
  lastTimestamp = 0;
  configuring = Promise.resolve();
}
