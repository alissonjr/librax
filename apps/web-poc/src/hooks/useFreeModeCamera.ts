import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lm } from '../lib/recognizer';
import { drawSkeleton } from '../lib/cameraUtils';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { getClassifier, loadClassifier, type Classifier } from '../recognition/classifier';
import { loadNumberClassifier } from '../recognition/numberModel';
import { getLetterMotionReadingRules, getMotionLetters, loadLetterMotionModel } from '../recognition/letterMotionModel';
import {
  createLetterMotionRecognizer, frameHand, letterWindowMotion, LETTER_EVAL_MS, LETTER_WINDOWS_S,
  type LetterMotionRecognizer,
} from '../recognition/letterMotion';
import type { ReadingRules } from '../recognition/readingRules';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';
import {
  FREE_START, freeAddSpace, freeClear, freeDeleteLast, freeResetReading, freeStep,
  type FreeConfig, type FreeMode, type FreeState,
} from '../lib/freeSpell';
import { confirmedGloss, nextStreak, NO_STREAK, type GlossStreak } from './useSignCameraRecognizer';
import { toLetterFrame } from './useLetterMotionCamera';

/**
 * Câmera do modo livre (lib/freeSpell.ts): um só vídeo e o landmarker da sessão, com o
 * reconhecedor do modo escolhido.
 *
 * - Letras: o classificador das letras paradas em todo quadro e, junto, o reconhecedor das letras
 *   com movimento (avaliado a cada LETTER_EVAL_MS, letra confirmada em duas avaliações seguidas,
 *   como no exercício). O landmarker procura duas mãos, como no treino do movimento; a mão lida é
 *   a mais alta. "Mexendo" é a janela mais curta passar do portão de movimento das regras.
 * - Números: só o modelo dos números (os que passaram no teste), uma mão.
 *
 * Nada é gravado nem enviado: o texto só existe nesta tela.
 */

export type FreeCamStatus = 'idle' | 'loading' | 'active' | 'denied' | 'error' | 'unsupported';

/** O que a tela mostra (publicado a cerca de 10 Hz, e na hora quando o texto muda). */
export interface FreeView {
  text: string;
  current: FreeState['current'];
  hint: FreeState['hint'];
  hintLetter: string | null;
  lastEvent: FreeState['lastEvent'];
  handPresent: boolean;
}

export interface FreeRecognizable {
  /** Letras (ou números) lidas paradas. */
  still: string[];
  /** Letras lidas pelo movimento (vazio sem o modelo). */
  motion: string[];
  /** O modelo do modo não carregou (números sem modelo baixado, por exemplo). */
  unavailable: boolean;
}

export interface UseFreeModeCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  status: FreeCamStatus;
  view: FreeView;
  recognizable: FreeRecognizable | null;
  start: () => Promise<void>;
  stop: () => void;
  deleteLast: () => void;
  clear: () => void;
  addSpace: () => void;
}

const DETECT_FPS = 15;
const PUBLISH_MS = 100;
const EMPTY: ReadonlySet<string> = new Set();

const EMPTY_VIEW: FreeView = {
  text: '', current: null, hint: null, hintLetter: null, lastEvent: null, handPresent: false,
};

function toView(s: FreeState, handPresent: boolean): FreeView {
  return { text: s.text, current: s.current, hint: s.hint, hintLetter: s.hintLetter, lastEvent: s.lastEvent, handPresent };
}

function sameView(a: FreeView, b: FreeView): boolean {
  return a.text === b.text && a.hint === b.hint && a.hintLetter === b.hintLetter && a.handPresent === b.handPresent
    && a.lastEvent?.seq === b.lastEvent?.seq
    && a.current?.letter === b.current?.letter && a.current?.motion === b.current?.motion
    && Math.round((a.current?.confidence ?? 0) * 20) === Math.round((b.current?.confidence ?? 0) * 20);
}

function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** Pede os modelos do modo. Nas letras, o classificador parado sempre existe (MLP ou heurístico). */
async function loadModels(mode: FreeMode) {
  if (mode === 'numeros') return { numbers: await loadNumberClassifier(), motion: null };
  const [, motion] = await Promise.all([loadClassifier(), loadLetterMotionModel()]);
  return { numbers: null, motion };
}

export function useFreeModeCamera(mode: FreeMode): UseFreeModeCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const mountedRef = useRef(false);
  const startIdRef = useRef(0);
  const modeRef = useRef(mode);

  const numberClfRef = useRef<Classifier | null>(null);
  const motionRef = useRef<{ recognizer: LetterMotionRecognizer; rules: ReadingRules; letters: ReadonlySet<string> } | null>(null);
  const streakRef = useRef<GlossStreak>(NO_STREAK);
  const motionReadingRef = useRef<{ letter: string | null; moving: boolean }>({ letter: null, moving: false });
  const lastEvalRef = useRef(-Infinity);
  const lastPublishRef = useRef(-Infinity);
  const stateRef = useRef<FreeState>(FREE_START);
  const viewRef = useRef<FreeView>(EMPTY_VIEW);

  const [status, setStatus] = useState<FreeCamStatus>('idle');
  const [view, setView] = useState<FreeView>(EMPTY_VIEW);
  const [recognizable, setRecognizable] = useState<FreeRecognizable | null>(null);

  const publish = useCallback((handPresent = viewRef.current.handPresent) => {
    const next = toView(stateRef.current, handPresent);
    if (sameView(viewRef.current, next)) return;
    viewRef.current = next;
    setView(next);
  }, []);

  const resetMotion = useCallback(() => {
    motionRef.current?.recognizer.reset();
    streakRef.current = NO_STREAK;
    motionReadingRef.current = { letter: null, moving: false };
  }, []);

  /** Carrega os modelos do modo e atualiza a lista do que a câmera lê. */
  const prepareMode = useCallback(async (m: FreeMode) => {
    const loaded = await loadModels(m);
    if (!mountedRef.current || modeRef.current !== m) return;
    if (m === 'numeros') {
      numberClfRef.current = loaded.numbers;
      setRecognizable({ still: sorted(loaded.numbers?.letters ?? EMPTY), motion: [], unavailable: !loaded.numbers });
      return;
    }
    if (loaded.motion && !motionRef.current) {
      const rules = getLetterMotionReadingRules();
      motionRef.current = { recognizer: createLetterMotionRecognizer(loaded.motion, rules), rules, letters: getMotionLetters() };
    }
    const motionLetters = motionRef.current?.letters ?? EMPTY;
    const still = [...getClassifier().letters].filter(l => !motionLetters.has(l));
    setRecognizable({ still: sorted(new Set(still)), motion: sorted(motionLetters), unavailable: false });
  }, []);

  const config = (): FreeConfig => {
    if (modeRef.current === 'numeros') {
      return { staticLetters: numberClfRef.current?.letters ?? EMPTY, motionLetters: EMPTY };
    }
    return { staticLetters: getClassifier().letters, motionLetters: motionRef.current?.letters ?? EMPTY };
  };

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handle = peekHandLandmarker();
    if (!video || !canvas || !handle || video.readyState < 2) return;

    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const aspect = video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
    const frame = toLetterFrame(now / 1000, detectHands(handle, video).result);
    const hand = frameHand(frame.hands);
    const letras = modeRef.current === 'letras';

    // Leitura parada da mão mais alta
    let staticLetter: string | null = null;
    let staticConfidence = 0;
    if (hand) {
      const clf = letras ? getClassifier() : numberClfRef.current;
      if (clf) {
        const r = clf.classify(hand.landmarks as Lm[], { handedness: hand.handedness, aspect });
        staticLetter = r.letter;
        staticConfidence = r.confidence;
      }
    }

    // Movimento (só nas letras, com o modelo)
    const motion = letras ? motionRef.current : null;
    if (motion) {
      motion.recognizer.push(frame, aspect);
      if (now - lastEvalRef.current >= LETTER_EVAL_MS) {
        lastEvalRef.current = now;
        const r = motion.recognizer.evaluate();
        streakRef.current = nextStreak(streakRef.current, r.letter);
        const shortest = motion.recognizer.windowInputs().find(w => w.duration === LETTER_WINDOWS_S[0]);
        const moving = shortest
          ? letterWindowMotion(shortest.input, motion.rules.motionShapeWeight) >= motion.rules.minMotion
          : false;
        motionReadingRef.current = { letter: confirmedGloss(streakRef.current), moving };
      }
    }

    const prevSeq = stateRef.current.lastEvent?.seq;
    stateRef.current = freeStep(stateRef.current, {
      t: now,
      handPresent: hand !== null,
      staticLetter,
      staticConfidence,
      motionLetter: motion ? motionReadingRef.current.letter : null,
      moving: motion ? motionReadingRef.current.moving : false,
    }, config());

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (hand) drawSkeleton(ctx, hand.landmarks as Lm[], canvas.width, canvas.height, staticConfidence, undefined, false);
    }

    const changed = stateRef.current.lastEvent?.seq !== prevSeq;
    if (changed || now - lastPublishRef.current >= PUBLISH_MS) {
      lastPublishRef.current = now;
      publish(hand !== null);
    }
  }, [publish]);

  const stop = useCallback(() => {
    startIdRef.current += 1;
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wakeRef.current?.release();
    wakeRef.current = null;
    resetMotion();
  }, [resetMotion]);

  const start = useCallback(async () => {
    const startId = ++startIdRef.current;
    const cancelled = () => !mountedRef.current || startIdRef.current !== startId;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }
    setStatus('loading');
    try {
      const m = modeRef.current;
      await Promise.all([prepareMode(m), getHandLandmarker(m === 'letras' ? 2 : 1)]);
      if (cancelled()) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      if (cancelled()) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          if ((err as { name?: unknown } | null)?.name !== 'AbortError') throw err;
        }
      }
      if (cancelled()) return;

      stateRef.current = freeResetReading(stateRef.current);
      setStatus('active');
      wakeRef.current?.release();
      wakeRef.current = keepScreenOn();
      stopLoopRef.current?.();
      if (video) stopLoopRef.current = startFrameLoop(video, onFrame, { maxFps: DETECT_FPS });
    } catch (err) {
      if (cancelled()) return;
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        setStatus('denied');
      } else if (err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')) {
        setStatus('unsupported');
      } else {
        console.error('[useFreeModeCamera]', err);
        setStatus('error');
      }
    }
  }, [onFrame, prepareMode]);

  // Troca de modo: o texto fica, a leitura recomeça; os modelos do novo modo carregam
  useEffect(() => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    stateRef.current = freeResetReading(stateRef.current);
    resetMotion();
    setRecognizable(null);
    publish();
    void prepareMode(mode);
    if (streamRef.current) void getHandLandmarker(mode === 'letras' ? 2 : 1).catch(() => {});
  }, [mode, prepareMode, publish, resetMotion]);

  useEffect(() => {
    mountedRef.current = true;
    // A lista do que a câmera lê aparece antes de ligar a câmera
    void prepareMode(modeRef.current);
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop, prepareMode]);

  const edit = useCallback((fn: (s: FreeState) => FreeState) => {
    stateRef.current = fn(stateRef.current);
    publish();
  }, [publish]);

  return {
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    status,
    view,
    recognizable,
    start,
    stop,
    deleteLast: useCallback(() => edit(freeDeleteLast), [edit]),
    clear: useCallback(() => edit(freeClear), [edit]),
    addSpace: useCallback(() => edit(freeAddSpace), [edit]),
  };
}
