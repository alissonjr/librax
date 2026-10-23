/**
 * Laço de quadros da câmera limitado a `maxFps` (15 por padrão, seção 3.1 do plano mobile web).
 *
 * - Usa requestVideoFrameCallback quando existe (Safari 15.4+, Chrome): só acorda quando chega
 *   quadro novo do vídeo. Sem ele, cai para requestAnimationFrame.
 * - O limite é um balde de créditos: a cada ms ganha `maxFps / 1000` de crédito e cada quadro
 *   processado gasta 1. Assim uma câmera de 24 ou 30 fps e uma tela de 60 ou 120 Hz dão a mesma
 *   média de `maxFps`, sem arredondar para baixo.
 * - Quadro que chega enquanto o anterior ainda processa é descartado (não enfileira).
 */

export type FrameCallback = (now: number) => void | Promise<unknown>;

export interface FrameLoopOptions {
  maxFps?: number;
}

/** Crédito máximo acumulado: evita rajada depois de uma pausa longa. */
const MAX_CREDIT = 1.5;
const SLACK = 0.05;

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function supportsVideoFrameCallback(video: HTMLVideoElement): boolean {
  return typeof (video as VideoWithRvfc).requestVideoFrameCallback === 'function';
}

/** Começa o laço e devolve a função que o para. */
export function startFrameLoop(
  video: HTMLVideoElement,
  onFrame: FrameCallback,
  { maxFps = 15 }: FrameLoopOptions = {},
): () => void {
  const v = video as VideoWithRvfc;
  const useRvfc = supportsVideoFrameCallback(video);
  const rate = maxFps / 1000;
  let stopped = false;
  let busy = false;
  let handle = 0;
  let credit = 1;
  let prev: number | null = null;

  const schedule = () => {
    if (stopped) return;
    handle = useRvfc ? v.requestVideoFrameCallback!(tick) : requestAnimationFrame(tick);
  };

  const tick = (now: number) => {
    if (stopped) return;
    schedule();
    if (prev !== null) credit = Math.min(MAX_CREDIT, credit + Math.max(0, now - prev) * rate);
    prev = now;
    // Folga pequena para o jitter dos timestamps não derrubar um quadro que estava no ponto
    if (busy || credit < 1 - SLACK) return;
    credit -= 1;
    busy = true;
    let out: void | Promise<unknown>;
    try {
      out = onFrame(now);
    } catch (err) {
      busy = false;
      throw err;
    }
    if (out && typeof (out as Promise<unknown>).then === 'function') {
      (out as Promise<unknown>).then(() => { busy = false; }, () => { busy = false; });
    } else {
      busy = false;
    }
  };

  schedule();

  return () => {
    stopped = true;
    if (useRvfc) v.cancelVideoFrameCallback?.(handle);
    else cancelAnimationFrame(handle);
  };
}
