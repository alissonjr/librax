import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import {
  confirmedGloss, nextStreak, NO_STREAK, useSignCameraRecognizer, type GlossStreak, type UseSignCameraRecognizerReturn,
} from '../hooks/useSignCameraRecognizer';
import { resetHandLandmarkerForTests } from '../recognition/landmarker';
import { resetPoseLandmarkerForTests } from '../recognition/poseLandmarker';
import { setSignModelForTests } from '../recognition/signModel';
import { EVAL_MS } from '../recognition/signRecognizer';
import type { MlpModel } from '../recognition/mlp';

// "Vimos X" e o acerto só valem com a mesma glosa em duas avaliações seguidas (plano de lições
// pós-treino, seção 5): no teste ao vivo apareciam leituras passageiras erradas antes do acerto.

const handDetect = vi.fn();
const poseDetect = vi.fn();
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: vi.fn(async () => ({ close: vi.fn(), detectForVideo: handDetect, setOptions: vi.fn(async () => {}) })) },
  PoseLandmarker: { createFromOptions: vi.fn(async () => ({ close: vi.fn(), detectForVideo: poseDetect })) },
}));

// Reconhecedor com as leituras em roteiro: cada evaluate() devolve a próxima glosa
const script: (string | null)[] = [];
vi.mock('../recognition/signRecognizer', async (importOriginal) => {
  const real = await importOriginal<typeof import('../recognition/signRecognizer')>();
  return {
    ...real,
    createSignRecognizer: () => ({
      labels: ['MESA', 'ARROZ', '_'],
      push: () => {},
      evaluate: () => {
        const gloss = script.shift() ?? null;
        return { gloss, probability: gloss ? 0.9 : 0, probs: new Float64Array(3), windows: 1 };
      },
      windowInputs: () => [],
      size: () => 0,
      reset: () => {},
    }),
  };
});

const run = (readings: (string | null)[]) => readings.reduce<GlossStreak>(nextStreak, NO_STREAK);

describe('confirmação da glosa (duas avaliações seguidas)', () => {
  it('uma leitura só não confirma', () => {
    expect(confirmedGloss(run(['ARROZ']))).toBeNull();
  });

  it('a mesma glosa duas vezes seguidas confirma', () => {
    expect(confirmedGloss(run(['MESA', 'MESA']))).toBe('MESA');
    expect(confirmedGloss(run(['MESA', 'MESA', 'MESA']))).toBe('MESA');
  });

  it('leitura passageira de outra glosa antes do acerto não aparece', () => {
    expect(confirmedGloss(run(['ARROZ', 'MESA']))).toBeNull();
    expect(confirmedGloss(run(['ARROZ', 'MESA', 'MESA']))).toBe('MESA');
  });

  it('avaliação sem glosa no meio recomeça a contagem', () => {
    expect(confirmedGloss(run(['MESA', null, 'MESA']))).toBeNull();
  });
});

let latest: UseSignCameraRecognizerReturn | null = null;
function Probe() {
  const r = useSignCameraRecognizer('MESA');
  latest = r;
  const { start } = r;
  useEffect(() => { start(); }, [start]);
  return (<><video ref={r.videoRef} /><canvas ref={r.canvasRef} /></>);
}

let frames: ((now: number) => void)[];
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  latest = null;
  frames = [];
  script.length = 0;
  resetHandLandmarkerForTests();
  resetPoseLandmarkerForTests();
  const model = { labels: ['MESA', 'ARROZ', '_'], normalizationVersion: 2, inputDim: 1, layers: [] } as unknown as MlpModel;
  setSignModelForTests({ model });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })) },
  });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (now: number) => void) => { frames.push(cb); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  handDetect.mockReturnValue({ landmarks: [], handedness: [], worldLandmarks: [], handednesses: [] });
  poseDetect.mockReturnValue({ landmarks: [], worldLandmarks: [] });
});

afterEach(() => {
  play.mockRestore();
  vi.unstubAllGlobals();
  setSignModelForTests(null);
});

describe('useSignCameraRecognizer: leitura confirmada', () => {
  it('só publica a glosa na segunda avaliação seguida igual', async () => {
    const ready = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      render(<Probe />);
      await waitFor(() => expect(latest?.status).toBe('active'));
      script.push('ARROZ', 'MESA', 'MESA');
      const seen: (string | null)[] = [];
      // Um quadro por avaliação
      for (let i = 0; i < 3; i++) {
        const tick = frames.at(-1)!;
        act(() => tick(i * EVAL_MS));
        seen.push(latest!.gloss);
      }
      expect(seen).toEqual([null, null, 'MESA']);
    } finally {
      getContext.mockRestore();
      if (ready) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', ready);
    }
  });
});
