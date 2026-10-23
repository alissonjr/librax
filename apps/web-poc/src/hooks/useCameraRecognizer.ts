import { useEffect, useRef, useState, useCallback } from 'react';
import { recognizeGesture, type Lm, type FingerExtensions } from '../lib/recognizer';
import { drawSkeleton } from '../lib/cameraUtils';
import { HAND_MODEL_URL as MODEL_URL, MEDIAPIPE_WASM_DIR as MEDIAPIPE_WASM } from '../recognition/mlAssets';

export type CamStatus = 'idle' | 'loading' | 'active' | 'denied' | 'error';

/** Como a mao detectada e visualizada. */
export type RenderMode = '2d' | '3d';

export interface UseCameraRecognizerOptions {
  /**
   * '2d' (padrao) desenha o esqueleto no canvas sobre o video.
   * '3d' nao desenha nada no canvas: os landmarks ficam em `landmarksRef`
   * para o avatar 3D consumir, e o video pode ficar escondido.
   */
  render?: RenderMode;
}

export interface UseCameraRecognizerReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  /** Ultimos 21 landmarks (ou null se nenhuma mao). Atualizado por frame, sem re-render. */
  landmarksRef: React.RefObject<Lm[] | null>;
  status: CamStatus;
  rawGesture: string | null;
  stableGesture: string | null;
  handPresent: boolean;
  confidence: number;
  extensions: FingerExtensions | null;
  start: () => Promise<void>;
  stop: () => void;
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

export function useCameraRecognizer(
  options: UseCameraRecognizerOptions = {},
): UseCameraRecognizerReturn {
  const { render = '2d' } = options;
  const renderRef = useRef<RenderMode>(render);
  renderRef.current = render;

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const landmarksRef = useRef<Lm[] | null>(null);
  const handLandmarkerRef = useRef<import('@mediapipe/tasks-vision').HandLandmarker | null>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  /** Falso depois do unmount: um start em andamento nao continua nem mexe no estado. */
  const mountedRef = useRef(false);
  /** Cada start ganha um numero; stop (ou um start mais novo) invalida o anterior. */
  const startIdRef = useRef(0);

  const [status, setStatus] = useState<CamStatus>('idle');
  const [rawGesture, setRawGesture] = useState<string | null>(null);
  const [handPresent, setHandPresent] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [extensions, setExtensions] = useState<FingerExtensions | null>(null);

  const stableGesture = useStableGesture(rawGesture);

  const detect = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const hl = handLandmarkerRef.current;
    if (!video || !canvas || !hl || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(detect);
      return;
    }

    // Sync canvas resolution to video every frame (handles late loadedmetadata)
    if (video.videoWidth > 0 && canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    const result = hl.detectForVideo(video, performance.now());
    const ctx = canvas.getContext('2d');
    if (!ctx) { rafRef.current = requestAnimationFrame(detect); return; }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (result.landmarks.length > 0) {
      const lms = result.landmarks[0] as Lm[];
      landmarksRef.current = lms;
      const { letter, confidence: conf, extensions: ext } = recognizeGesture(lms);
      setHandPresent(true);
      setRawGesture(letter);
      setConfidence(conf);
      setExtensions(ext);
      // No modo 3d o avatar (HandAvatar3D) cuida do visual; aqui so detectamos.
      if (renderRef.current === '2d') {
        drawSkeleton(ctx, lms, canvas.width, canvas.height, conf);
      }
    } else {
      landmarksRef.current = null;
      setHandPresent(false);
      setRawGesture(null);
      setExtensions(null);
    }

    rafRef.current = requestAnimationFrame(detect);
  }, []);

  const stop = useCallback(() => {
    startIdRef.current += 1;
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    handLandmarkerRef.current?.close();
    handLandmarkerRef.current = null;
  }, []);

  const start = useCallback(async () => {
    const startId = ++startIdRef.current;
    // O exercicio pode ser pulado (desmontado) enquanto o modelo ou a camera carregam.
    const cancelled = () => !mountedRef.current || startIdRef.current !== startId;
    setStatus('loading');
    try {
      const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
      if (cancelled()) { landmarker.close(); return; }
      handLandmarkerRef.current = landmarker;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      // Stream que chegou depois do unmount: desliga na hora para a camera nao ficar acesa
      if (cancelled()) { stopTracks(stream); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (err) {
          // "play() interrupted": o video foi pausado ou removido antes de comecar a tocar
          if (!isAbortError(err)) throw err;
        }
      }
      if (cancelled()) return;

      if (canvasRef.current && videoRef.current) {
        const sync = () => {
          if (canvasRef.current && videoRef.current) {
            canvasRef.current.width = videoRef.current.videoWidth || 640;
            canvasRef.current.height = videoRef.current.videoHeight || 480;
          }
        };
        videoRef.current.addEventListener('loadedmetadata', sync);
      }

      setStatus('active');
      rafRef.current = requestAnimationFrame(detect);
    } catch (err) {
      if (cancelled()) return;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setStatus('denied');
      } else {
        console.error('[useCameraRecognizer]', err);
        setStatus('error');
      }
    }
  }, [detect]);

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
    status, rawGesture, stableGesture, handPresent, confidence, extensions, start, stop,
  };
}

function stopTracks(stream: MediaStream) {
  stream.getTracks().forEach(t => t.stop());
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'AbortError';
}
