import { useCallback, useEffect, useRef, useState } from 'react';
import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Lm } from '../lib/recognizer';
import { drawSkeleton } from '../lib/cameraUtils';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { detectPose, getPoseLandmarker, peekPoseLandmarker } from '../recognition/poseLandmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { loadSignModel } from '../recognition/signModel';
import { createSignRecognizer, EVAL_MS, probabilityOf, type SignRecognizer } from '../recognition/signRecognizer';
import type { SignFrame } from '../recognition/signFeatures';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';
import type { CamStatus } from './useCameraRecognizer';

/**
 * Câmera dos sinais com movimento: as duas mãos (o landmarker da sessão com numHands 2) e o
 * corpo (PoseLandmarker lite) em cada quadro, no reconhecedor de src/recognition/signRecognizer.ts.
 *
 * Mesmo ciclo de vida do useCameraRecognizer (as letras continuam nele, sem mudança): parar só
 * solta o stream, o laço e o Wake Lock; os modelos ficam para o próximo exercício. Sem modelo de
 * sinais (ou se ele não carregar) o status vira 'unavailable' e a tela cai na prática sem nota.
 */

export type SignCamStatus = CamStatus | 'unavailable';

export interface SignCameraReading {
  /** Alguma mão no quadro. */
  handPresent: boolean;
  /** Corpo (nariz e ombros) no quadro: sem ele não há leitura. */
  bodyPresent: boolean;
  /**
   * Glosa lida em CONFIRM_READINGS avaliações seguidas, ou null. A leitura de uma avaliação só
   * não chega aqui: nos testes ao vivo apareciam leituras passageiras erradas antes do acerto.
   */
  gloss: string | null;
  /** Probabilidade da glosa alvo na última avaliação (0 a 1). */
  targetProbability: number;
}

export interface UseSignCameraRecognizerReturn extends SignCameraReading {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  status: SignCamStatus;
  start: () => Promise<void>;
  stop: () => void;
}

/** Mesmo teto de quadros das letras (plano mobile web 3.1). */
const DETECT_FPS = 15;
const PUBLISH_MS = 100;

const EMPTY: SignCameraReading = { handPresent: false, bodyPresent: false, gloss: null, targetProbability: 0 };

/** Avaliações seguidas com a mesma glosa para a leitura valer ("Vimos X" ou acerto). */
export const CONFIRM_READINGS = 2;

/** Glosa da última avaliação e quantas avaliações seguidas a leram. */
export interface GlossStreak {
  gloss: string | null;
  count: number;
}

export const NO_STREAK: GlossStreak = { gloss: null, count: 0 };

/** Soma uma avaliação: a mesma glosa conta mais uma; outra glosa recomeça; nenhuma zera. */
export function nextStreak(prev: GlossStreak, gloss: string | null): GlossStreak {
  if (gloss === null) return NO_STREAK;
  return gloss === prev.gloss ? { gloss, count: prev.count + 1 } : { gloss, count: 1 };
}

/** A glosa da sequência, quando ela já tem CONFIRM_READINGS avaliações; senão null. */
export function confirmedGloss(streak: GlossStreak): string | null {
  return streak.count >= CONFIRM_READINGS ? streak.gloss : null;
}

function same(a: SignCameraReading, b: SignCameraReading): boolean {
  return a.handPresent === b.handPresent && a.bodyPresent === b.bodyPresent && a.gloss === b.gloss
    && Math.round(a.targetProbability * 100) === Math.round(b.targetProbability * 100);
}

/** Resultado do MediaPipe -> quadro do reconhecedor (tempo em segundos). */
export function toSignFrame(t: number, hands: HandLandmarkerResult, pose: PoseLandmarkerResult | null): SignFrame {
  return {
    t,
    hands: hands.landmarks.map((landmarks, i) => ({
      handedness: hands.handedness?.[i]?.[0]?.categoryName ?? null,
      landmarks: landmarks as Lm[],
    })),
    pose: (pose?.landmarks?.[0] as Lm[] | undefined) ?? null,
  };
}

export function useSignCameraRecognizer(target: string): UseSignCameraRecognizerReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const recognizerRef = useRef<SignRecognizer | null>(null);
  const lastEvalRef = useRef(-Infinity);
  const lastPublishRef = useRef(-Infinity);
  const readingRef = useRef<SignCameraReading>(EMPTY);
  const streakRef = useRef<GlossStreak>(NO_STREAK);
  const targetRef = useRef(target);
  targetRef.current = target;
  const mountedRef = useRef(false);
  const startIdRef = useRef(0);

  const [status, setStatus] = useState<SignCamStatus>('idle');
  const [reading, setReading] = useState<SignCameraReading>(EMPTY);

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const hands = peekHandLandmarker();
    const pose = peekPoseLandmarker();
    const recognizer = recognizerRef.current;
    if (!video || !canvas || !hands || !pose || !recognizer || video.readyState < 2) return;

    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const aspect = video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
    const handResult = detectHands(hands, video).result;
    const poseResult = detectPose(pose, video);
    const frame = toSignFrame(now / 1000, handResult, poseResult);
    recognizer.push(frame, aspect);

    let next: SignCameraReading;
    const presence = { handPresent: frame.hands.length > 0, bodyPresent: frame.pose !== null };
    const evaluated = now - lastEvalRef.current >= EVAL_MS;
    if (evaluated) {
      lastEvalRef.current = now;
      const r = recognizer.evaluate();
      streakRef.current = nextStreak(streakRef.current, r.gloss);
      next = {
        ...presence,
        gloss: confirmedGloss(streakRef.current),
        targetProbability: probabilityOf(r, recognizer.labels, targetRef.current),
      };
    } else {
      next = { ...readingRef.current, ...presence };
    }
    readingRef.current = next;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const confidence = next.gloss === targetRef.current ? 1 : next.targetProbability;
      for (const h of frame.hands) drawSkeleton(ctx, h.landmarks as Lm[], canvas.width, canvas.height, confidence, undefined, false);
    }

    // A leitura nova de cada avaliação sempre chega à tela; entre elas, só a presença, a ~10 Hz
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
      const [model] = await Promise.all([loadSignModel(), getHandLandmarker(2), getPoseLandmarker()]);
      if (cancelled()) return;
      if (!model) {
        setStatus('unavailable');
        return;
      }
      recognizerRef.current = createSignRecognizer(model);

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
        console.error('[useSignCameraRecognizer]', err);
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
