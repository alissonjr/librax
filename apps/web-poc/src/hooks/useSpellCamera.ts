import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lm } from '../lib/recognizer';
import type { SpellReader } from '../lib/fingerspell';
import { drawSkeleton } from '../lib/cameraUtils';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { getClassifier, loadClassifier, type Classifier } from '../recognition/classifier';
import { loadNumberClassifier } from '../recognition/numberModel';
import { getLetterMotionReadingRules, loadLetterMotionModel } from '../recognition/letterMotionModel';
import {
  createLetterMotionRecognizer, frameHand, LETTER_EVAL_MS, type LetterMotionRecognizer,
} from '../recognition/letterMotion';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';
import { useStableGesture, type CamStatus } from './useCameraRecognizer';
import { confirmedGloss, nextStreak, NO_STREAK, type GlossStreak } from './useSignCameraRecognizer';
import { toLetterFrame } from './useLetterMotionCamera';

/**
 * Câmera da soletração (ExerciseFingerspell): um vídeo e um laço de quadros para a palavra
 * inteira, com o leitor trocando a cada letra (spec-03 5.4).
 *
 * - Passo 'letras' ou 'numeros': o classificador da mão parada (o das letras ou o dos números) lê a
 *   mão e a leitura estável sai do useStableGesture (400 ms iguais), como no useCameraRecognizer.
 * - Passo 'letras-mov': os quadros vão para o reconhecedor das letras com movimento (buffer de
 *   2 s, janelas de 0,8 a 1,6 s, avaliação a cada LETTER_EVAL_MS) e a letra só vale com duas
 *   avaliações seguidas iguais, como no useLetterMotionCamera. Ao chegar num passo com movimento o
 *   buffer recomeça: o movimento da letra anterior não conta para a da vez.
 * - Passo 'livre': nada é lido (a pessoa confirma na tela); o esqueleto continua desenhado.
 *
 * Com alguma letra com movimento na palavra, o landmarker procura duas mãos e a mão lida é a mais
 * alta (frameHand), a mesma regra do modelo das letras com movimento. Sem modelo para um leitor que
 * a palavra usa, a câmera fica em 'error' (a tela oferece tentar de novo ou pular).
 */

export interface SpellCameraReading {
  handPresent: boolean;
  /** Leitura do classificador da mão parada no quadro (sem estabilizar), ou null. */
  rawGesture: string | null;
  /** Letra com movimento confirmada em duas avaliações seguidas, ou null. */
  motionLetter: string | null;
  /** Confiança da leitura do passo da vez (0 a 1): a do classificador, ou a probabilidade da letra alvo. */
  confidence: number;
}

export interface UseSpellCameraReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  status: CamStatus;
  handPresent: boolean;
  /** Leitura estável da mão parada (letras ou números). */
  stableGesture: string | null;
  motionLetter: string | null;
  confidence: number;
  start: () => Promise<void>;
  stop: () => void;
}

const DETECT_FPS = 15;
const PUBLISH_MS = 100;

const EMPTY: SpellCameraReading = { handPresent: false, rawGesture: null, motionLetter: null, confidence: 0 };

function same(a: SpellCameraReading, b: SpellCameraReading): boolean {
  return a.handPresent === b.handPresent && a.rawGesture === b.rawGesture && a.motionLetter === b.motionLetter
    && Math.round(a.confidence * 100) === Math.round(b.confidence * 100);
}

/**
 * @param letters letras (ou dígitos) da palavra
 * @param readers leitor de cada letra (mesmo tamanho de `letters`)
 * @param index passo da vez (letters.length com a palavra completa)
 */
export function useSpellCamera(letters: readonly string[], readers: readonly SpellReader[], index: number): UseSpellCameraReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const numberClassifierRef = useRef<Classifier | null>(null);
  const motionRef = useRef<LetterMotionRecognizer | null>(null);
  const streakRef = useRef<GlossStreak>(NO_STREAK);
  const lastEvalRef = useRef(-Infinity);
  const lastPublishRef = useRef(-Infinity);
  const readingRef = useRef<SpellCameraReading>(EMPTY);
  const mountedRef = useRef(false);
  const startIdRef = useRef(0);

  const lettersRef = useRef(letters);
  lettersRef.current = letters;
  const readersRef = useRef(readers);
  readersRef.current = readers;
  const indexRef = useRef(index);
  indexRef.current = index;

  const usesMotion = readers.includes('letras-mov');
  const usesNumbers = readers.includes('numeros');
  const usesLetters = readers.includes('letras');

  const [status, setStatus] = useState<CamStatus>('idle');
  const [reading, setReading] = useState<SpellCameraReading>(EMPTY);

  // Chegou a vez de uma letra com movimento: o buffer e a sequência de leituras recomeçam
  const reader = readers[index] ?? null;
  useEffect(() => {
    if (reader !== 'letras-mov') return;
    motionRef.current?.reset();
    streakRef.current = NO_STREAK;
    lastEvalRef.current = -Infinity;
    readingRef.current = { ...readingRef.current, motionLetter: null };
    setReading(prev => (prev.motionLetter === null ? prev : { ...prev, motionLetter: null }));
  }, [index, reader]);

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
    const motion = motionRef.current;
    motion?.push(frame, aspect);

    const hand = frameHand(frame.hands);
    const current = readersRef.current[indexRef.current] ?? null;
    const target = lettersRef.current[indexRef.current] ?? null;
    let next: SpellCameraReading = { ...readingRef.current, handPresent: hand !== null };

    if (current === 'letras' || current === 'numeros') {
      const clf = current === 'numeros' ? numberClassifierRef.current : getClassifier();
      if (hand && clf) {
        const r = clf.classify(hand.landmarks as Lm[], { handedness: hand.handedness, aspect });
        next = { ...next, rawGesture: r.letter, motionLetter: null, confidence: r.confidence };
      } else {
        next = { ...next, rawGesture: null, motionLetter: null, confidence: 0 };
      }
    } else if (current === 'letras-mov' && motion) {
      next = { ...next, rawGesture: null };
      if (now - lastEvalRef.current >= LETTER_EVAL_MS) {
        lastEvalRef.current = now;
        const r = motion.evaluate();
        streakRef.current = nextStreak(streakRef.current, r.letter);
        const i = target ? motion.labels.indexOf(target) : -1;
        next = { ...next, motionLetter: confirmedGloss(streakRef.current), confidence: i >= 0 ? r.probs[i] : 0 };
      }
    } else {
      next = { ...next, rawGesture: null, motionLetter: null, confidence: 0 };
    }
    readingRef.current = next;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (hand) drawSkeleton(ctx, hand.landmarks as Lm[], canvas.width, canvas.height, next.confidence);
    }

    if (now - lastPublishRef.current >= PUBLISH_MS) {
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
    motionRef.current?.reset();
    streakRef.current = NO_STREAK;
  }, []);

  const start = useCallback(async () => {
    const startId = ++startIdRef.current;
    const cancelled = () => !mountedRef.current || startIdRef.current !== startId;
    setStatus('loading');
    try {
      if (usesLetters) loadClassifier();
      const [numbers, motionModel] = await Promise.all([
        usesNumbers ? loadNumberClassifier() : Promise.resolve(null),
        usesMotion ? loadLetterMotionModel() : Promise.resolve(null),
        getHandLandmarker(usesMotion ? 2 : 1),
      ]);
      if (cancelled()) return;
      if (usesNumbers && !numbers) throw new Error('modelo dos números indisponível');
      if (usesMotion && !motionModel) throw new Error('modelo das letras com movimento indisponível');
      numberClassifierRef.current = numbers;
      motionRef.current = motionModel ? createLetterMotionRecognizer(motionModel, getLetterMotionReadingRules()) : null;
      streakRef.current = NO_STREAK;

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
        console.error('[useSpellCamera]', err);
        setStatus('error');
      }
    }
  }, [onFrame, usesLetters, usesMotion, usesNumbers]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  const stableGesture = useStableGesture(reading.rawGesture);

  return {
    videoRef: videoRef as React.RefObject<HTMLVideoElement>,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    status,
    handPresent: reading.handPresent,
    stableGesture,
    motionLetter: reading.motionLetter,
    confidence: reading.confidence,
    start,
    stop,
  };
}
