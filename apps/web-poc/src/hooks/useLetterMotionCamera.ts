import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Lm } from '../lib/recognizer';
import { drawSkeleton } from '../lib/cameraUtils';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { loadLetterMotionModel } from '../recognition/letterMotionModel';
import {
  createLetterMotionRecognizer, LETTER_EVAL_MS, type LetterFrame, type LetterMotionRecognizer,
} from '../recognition/letterMotion';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';
import { confirmedGloss, nextStreak, NO_STREAK, type GlossStreak, type SignCamStatus } from './useSignCameraRecognizer';

/**
 * Câmera das letras com movimento (H, J, K, X, Z e Ç): as mãos (o landmarker da sessão com
 * numHands 2, a mão que faz a letra é a mais alta) no reconhecedor de src/recognition/letterMotion.ts.
 * Sem o modelo do corpo.
 *
 * Mesmo ciclo de vida do useSignCameraRecognizer, e a mesma regra de leitura: a letra só vale
 * quando duas avaliações seguidas (a cada LETTER_EVAL_MS) leem a mesma. Sem modelo (ou se ele não
 * carregar) o status vira 'unavailable' e a tela cai na prática sem nota.
 */

export interface LetterMotionReadingState {
  handPresent: boolean;
  /** Letra lida em duas avaliações seguidas, ou null. */
  letter: string | null;
  /** Probabilidade da letra alvo na última avaliação (0 a 1). */
  targetProbability: number;
}

export interface UseLetterMotionCameraReturn extends LetterMotionReadingState {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  status: SignCamStatus;
  start: () => Promise<void>;
  stop: () => void;
}

const DETECT_FPS = 15;
const PUBLISH_MS = 100;

const EMPTY: LetterMotionReadingState = { handPresent: false, letter: null, targetProbability: 0 };

function same(a: LetterMotionReadingState, b: LetterMotionReadingState): boolean {
  return a.handPresent === b.handPresent && a.letter === b.letter
    && Math.round(a.targetProbability * 100) === Math.round(b.targetProbability * 100);
}

/** Resultado do MediaPipe -> quadro do reconhecedor (tempo em segundos). */
export function toLetterFrame(t: number, hands: HandLandmarkerResult): LetterFrame {
  return {
    t,
    hands: hands.landmarks.map((landmarks, i) => ({
      handedness: hands.handedness?.[i]?.[0]?.categoryName ?? null,
      landmarks: landmarks as Lm[],
    })),
  };
}

export function useLetterMotionCamera(target: string): UseLetterMotionCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const recognizerRef = useRef<LetterMotionRecognizer | null>(null);
  const lastEvalRef = useRef(-Infinity);
  const lastPublishRef = useRef(-Infinity);
  const readingRef = useRef<LetterMotionReadingState>(EMPTY);
  const streakRef = useRef<GlossStreak>(NO_STREAK);
  const targetRef = useRef(target);
  targetRef.current = target;
  const mountedRef = useRef(false);
  const startIdRef = useRef(0);

  const [status, setStatus] = useState<SignCamStatus>('idle');
  const [reading, setReading] = useState<LetterMotionReadingState>(EMPTY);

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const hands = peekHandLandmarker();
    const recognizer = recognizerRef.current;
    if (!video || !canvas || !hands || !recognizer || video.readyState < 2) return;

    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const aspect = video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
    const frame = toLetterFrame(now / 1000, detectHands(hands, video).result);
    recognizer.push(frame, aspect);

    let next: LetterMotionReadingState;
    const handPresent = frame.hands.length > 0;
    const evaluated = now - lastEvalRef.current >= LETTER_EVAL_MS;
    if (evaluated) {
      lastEvalRef.current = now;
      const r = recognizer.evaluate();
      streakRef.current = nextStreak(streakRef.current, r.letter);
      const i = recognizer.labels.indexOf(targetRef.current);
      next = { handPresent, letter: confirmedGloss(streakRef.current), targetProbability: i >= 0 ? r.probs[i] : 0 };
    } else {
      next = { ...readingRef.current, handPresent };
    }
    readingRef.current = next;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const confidence = next.letter === targetRef.current ? 1 : next.targetProbability;
      for (const h of frame.hands) drawSkeleton(ctx, h.landmarks as Lm[], canvas.width, canvas.height, confidence, undefined, false);
    }

    if (evaluated || now - lastPublishRef.current >= PUBLISH_MS) {
      lastPublishRef.current = now;
      setReading(prev => (same(prev, next) ? prev : next));
    }
  }, []);

  const stop = useCallback(() => {
    startIdRef.current += 1;
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wakeRef.current?.release();
    wakeRef.current = null;
    recognizerRef.current?.reset();
    streakRef.current = NO_STREAK;
  }, []);

  const start = useCallback(async () => {
    const startId = ++startIdRef.current;
    const cancelled = () => !mountedRef.current || startIdRef.current !== startId;
    setStatus('loading');
    try {
      const [model] = await Promise.all([loadLetterMotionModel(), getHandLandmarker(2)]);
      if (cancelled()) return;
      if (!model) {
        setStatus('unavailable');
        return;
      }
      recognizerRef.current = createLetterMotionRecognizer(model);

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

      setStatus('active');
      wakeRef.current?.release();
      wakeRef.current = keepScreenOn();
      stopLoopRef.current?.();
      if (video) stopLoopRef.current = startFrameLoop(video, onFrame, { maxFps: DETECT_FPS });
    } catch (err) {
      if (cancelled()) return;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setStatus('denied');
      } else {
        console.error('[useLetterMotionCamera]', err);
        setStatus('error');
      }
    }
  }, [onFrame]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  return {
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    status,
    ...reading,
    start,
    stop,
  };
}
