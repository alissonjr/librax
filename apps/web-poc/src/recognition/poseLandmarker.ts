import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { MEDIAPIPE_WASM_DIR, POSE_MODEL_URL } from './mlAssets';
import type { Delegate } from './landmarker';

/**
 * PoseLandmarker lite único por sessão, só para os sinais com movimento (onde a mão está em
 * relação ao corpo). Mesmas opções da página de treino (src/treino/TreinoVideoPage.tsx): VIDEO,
 * uma pessoa, GPU com queda para CPU. Criado sob demanda, na primeira lição com exercício de sinal
 * avaliado pela câmera; as letras nunca carregam este modelo.
 */

export interface PoseHandle {
  landmarker: PoseLandmarker;
  delegate: Delegate;
}

let pending: Promise<PoseHandle> | null = null;
let ready: PoseHandle | null = null;
let lastTimestamp = 0;

async function create(): Promise<PoseHandle> {
  const { PoseLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_DIR);
  const build = (delegate: Delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  try {
    return { landmarker: await build('GPU'), delegate: 'GPU' };
  } catch {
    return { landmarker: await build('CPU'), delegate: 'CPU' };
  }
}

/** PoseLandmarker da sessão; cria na primeira chamada. Falhou: a próxima chamada tenta de novo. */
export function getPoseLandmarker(): Promise<PoseHandle> {
  if (!pending) {
    const promise = create();
    pending = promise;
    promise.then(
      (handle) => { if (pending === promise) ready = handle; },
      () => { if (pending === promise) pending = null; },
    );
  }
  return pending;
}

/** Começa a carregar sem esperar (lição com sinal avaliado pela câmera). */
export function warmUpPoseLandmarker(): void {
  getPoseLandmarker().catch(() => { /* quem usar de fato trata o erro */ });
}

export function peekPoseLandmarker(): PoseHandle | null {
  return ready;
}

/** Corpo no quadro atual do vídeo (timestamps sempre crescentes, como no landmarker das mãos). */
export function detectPose(handle: PoseHandle, video: HTMLVideoElement): PoseLandmarkerResult {
  const timestamp = Math.max(performance.now(), lastTimestamp + 1);
  lastTimestamp = timestamp;
  return handle.landmarker.detectForVideo(video, timestamp);
}

/** Só para testes. */
export function resetPoseLandmarkerForTests(): void {
  pending = null;
  ready = null;
  lastTimestamp = 0;
}
