import { useEffect, useRef, useState, useCallback } from 'react';
import type { Lm, FingerExtensions } from '../lib/recognizer';
import { drawSkeleton } from '../lib/cameraUtils';
import { detectHands, getHandLandmarker, peekHandLandmarker } from '../recognition/landmarker';
import { startFrameLoop } from '../recognition/frameLoop';
import { getClassifier, loadClassifier, type Classifier } from '../recognition/classifier';
import { loadNumberClassifier } from '../recognition/numberModel';
import { keepScreenOn, type WakeLockHandle } from '../platform/wakeLock';

export type CamStatus = 'idle' | 'loading' | 'active' | 'denied' | 'error';

/** Landmarker da sessão visto por quem usa o hook: carregando, pronto ou sem conseguir carregar. */
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Como a mao detectada e visualizada. */
export type RenderMode = '2d' | '3d';

export interface UseCameraRecognizerOptions {
  /**
   * '2d' (padrao) desenha o esqueleto no canvas sobre o video.
   * '3d' nao desenha nada no canvas: os landmarks ficam em `landmarksRef`
   * para o avatar 3D consumir (o video continua renderizado, nunca com display:none).
   */
  render?: RenderMode;
  /**
   * Quem lê a mão: 'letras' (padrão), o classificador das letras paradas; 'numeros', o modelo dos
   * números de 0 a 9 (/ml/numeros/, src/recognition/numberModel.ts), carregado ao ligar a câmera.
   */
  classifier?: 'letras' | 'numeros';
  /**
   * Pede a câmera antes de esperar o modelo (boas-vindas): o pedido de permissão aparece na hora,
   * o vídeo fica 'active' assim que toca e o esqueleto começa quando o landmarker fica pronto
   * (`modelStatus`). Se o modelo não carregar, o vídeo continua, só sem esqueleto. Padrão: false,
   * os exercícios esperam o modelo antes de abrir a câmera.
   */
  cameraFirst?: boolean;
}

export interface UseCameraRecognizerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Ultimos 21 landmarks (ou null se nenhuma mao). Atualizado por frame, sem re-render. */
  landmarksRef: React.RefObject<Lm[] | null>;
  status: CamStatus;
  modelStatus: ModelStatus;
  rawGesture: string | null;
  stableGesture: string | null;
  handPresent: boolean;
  confidence: number;
  extensions: FingerExtensions | null;
  start: () => Promise<void>;
  stop: () => void;
}

/** Deteccao a ate 15 fps (plano mobile web 3.1). */
const DETECT_FPS = 15;
/** A tela recebe a leitura a cerca de 10 Hz; o laco de quadros nunca chama setState direto. */
const PUBLISH_MS = 100;

interface Reading {
  rawGesture: string | null;
  handPresent: boolean;
  confidence: number;
  extensions: FingerExtensions | null;
}

const NO_HAND: Reading = { rawGesture: null, handPresent: false, confidence: 0, extensions: null };

function sameReading(a: Reading, b: Reading): boolean {
  if (a.rawGesture !== b.rawGesture || a.handPresent !== b.handPresent) return false;
  if (Math.round(a.confidence * 100) !== Math.round(b.confidence * 100)) return false;
  const ea = a.extensions;
  const eb = b.extensions;
  if (!ea || !eb) return ea === eb;
  return ea.thumb === eb.thumb && ea.index === eb.index && ea.middle === eb.middle
    && ea.ring === eb.ring && ea.pinky === eb.pinky;
}

/**
 * Confirma o gesto quando a leitura fica igual por `holdMs` (SPEC 01: ~400ms).
 * Conta por tempo, nao por quadros: o React so re-renderiza quando a leitura muda,
 * entao um contador por render nunca passava de 1 e o gesto nunca estabilizava.
 */
export function useStableGesture(raw: string | null, holdMs = 400) {
  const [stable, setStable] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setStable(raw), holdMs);
    return () => clearTimeout(timer);
  }, [raw, holdMs]);

  return stable;
}

/**
 * Camera + reconhecimento de um exercicio.
 *
 * Usa o HandLandmarker da sessao (src/recognition/landmarker.ts): o modelo e carregado uma vez
 * e sobrevive ao fim do exercicio; parar a camera so solta o stream, o laco e o Wake Lock.
 * O classificador e o MLP treinado quando /ml/classifier/model.json existe, senao o heuristico.
 */
export function useCameraRecognizer(
  options: UseCameraRecognizerOptions = {},
): UseCameraRecognizerReturn {
  const { render = '2d', classifier = 'letras', cameraFirst = false } = options;
  const renderRef = useRef<RenderMode>(render);
  renderRef.current = render;
  const classifierKindRef = useRef(classifier);
  classifierKindRef.current = classifier;
  const cameraFirstRef = useRef(cameraFirst);
  cameraFirstRef.current = cameraFirst;
  /** Classificador dos números, depois do loadNumberClassifier (null até lá ou nas letras). */
  const numberClassifierRef = useRef<Classifier | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarksRef = useRef<Lm[] | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const wakeRef = useRef<WakeLockHandle | null>(null);
  const lastPublishRef = useRef(-Infinity);
  /** Falso depois do unmount: um start em andamento nao continua nem mexe no estado. */
  const mountedRef = useRef(false);
  /** Cada start ganha um numero; stop (ou um start mais novo) invalida o anterior. */
  const startIdRef = useRef(0);

  const [status, setStatus] = useState<CamStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [reading, setReading] = useState<Reading>(NO_HAND);

  const stableGesture = useStableGesture(reading.rawGesture);

  const onFrame = useCallback((now: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const handle = peekHandLandmarker();
    if (!video || !canvas || !handle || video.readyState < 2) return;

    // A resolucao do canvas acompanha a do video (o loadedmetadata pode chegar tarde)
    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const { result } = detectHands(handle, video);
    const ctx = canvas.getContext('2d');
    let next: Reading;

    if (result.landmarks.length > 0) {
      const lms = result.landmarks[0] as Lm[];
      landmarksRef.current = lms;
      const handedness = result.handedness?.[0]?.[0]?.categoryName ?? null;
      const aspect = video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 1;
      const clf = classifierKindRef.current === 'numeros' ? numberClassifierRef.current : getClassifier();
      const { letter, confidence, extensions } = clf
        ? clf.classify(lms, { handedness, aspect })
        : { letter: null, confidence: 0, extensions: null };
      next = { rawGesture: letter, handPresent: true, confidence, extensions };
      // No modo 3d o avatar (HandAvatar3D) cuida do visual; aqui so detectamos.
      if (ctx && renderRef.current === '2d') drawSkeleton(ctx, lms, canvas.width, canvas.height, confidence);
      else ctx?.clearRect(0, 0, canvas.width, canvas.height);
    } else {
      landmarksRef.current = null;
      next = NO_HAND;
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (now - lastPublishRef.current >= PUBLISH_MS) {
      lastPublishRef.current = now;
      setReading(prev => (sameReading(prev, next) ? prev : next));
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
    landmarksRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const startId = ++startIdRef.current;
    // O exercicio pode ser pulado (desmontado) enquanto o modelo ou a camera carregam.
    const cancelled = () => !mountedRef.current || startIdRef.current !== startId;
    setStatus('loading');
    try {
      if (classifierKindRef.current === 'numeros') {
        // Pesos dos números: sem eles a câmera não tem como dar nota
        numberClassifierRef.current = await loadNumberClassifier();
        if (cancelled()) return;
        if (!numberClassifierRef.current) throw new Error('modelo dos números indisponível');
      } else {
        loadClassifier();
      }
      // Landmarker da sessao: na maioria das vezes ja esta pronto (aquecido ao abrir a licao)
      const landmarker = getHandLandmarker();
      if (!peekHandLandmarker()) setModelStatus('loading');
      if (cameraFirstRef.current) {
        // Sem esperar: o laco de quadros so desenha quando o landmarker existir (peekHandLandmarker)
        landmarker.then(
          () => { if (mountedRef.current) setModelStatus('ready'); },
          (err) => {
            console.warn('[useCameraRecognizer] modelo da mao indisponivel', err);
            if (mountedRef.current) setModelStatus('error');
          },
        );
      } else {
        await landmarker;
        if (cancelled()) return;
        setModelStatus('ready');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      // Stream que chegou depois do unmount: desliga na hora para a camera nao ficar acesa
      if (cancelled()) { stopTracks(stream); return; }
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        try {
          await video.play();
        } catch (err) {
          // "play() interrupted": o video foi pausado ou removido antes de comecar a tocar
          if (!isAbortError(err)) throw err;
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
        console.error('[useCameraRecognizer]', err);
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
    landmarksRef: landmarksRef as React.RefObject<Lm[] | null>,
    status,
    modelStatus,
    rawGesture: reading.rawGesture,
    stableGesture,
    handPresent: reading.handPresent,
    confidence: reading.confidence,
    extensions: reading.extensions,
    start,
    stop,
  };
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach(t => t.stop());
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}
