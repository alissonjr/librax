import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { toSignFrame, useSignCameraRecognizer, type UseSignCameraRecognizerReturn } from '../hooks/useSignCameraRecognizer';
import { resetHandLandmarkerForTests } from '../recognition/landmarker';
import { resetPoseLandmarkerForTests } from '../recognition/poseLandmarker';
import { setSignModelForTests } from '../recognition/signModel';
import { SIGN_FRAME_DIM, SIGN_INPUT_DIM } from '../recognition/signFeatures';
import { POSE_MODEL_URL } from '../recognition/mlAssets';
import type { MlpModel } from '../recognition/mlp';

// MediaPipe fica fora do teste: as mãos e o corpo de cada quadro vêm destes mocks
const handDetect = vi.fn();
const poseDetect = vi.fn();
const setOptions = vi.fn(async () => {});
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: vi.fn(async () => ({ close: vi.fn(), detectForVideo: handDetect, setOptions })) },
  PoseLandmarker: { createFromOptions: vi.fn(async () => ({ close: vi.fn(), detectForVideo: poseDetect })) },
}));

/** Lê MESA sempre que a dominante aparece no último quadro do modelo. */
function mesaModel(): MlpModel {
  const kernel = new Float32Array(SIGN_INPUT_DIM * 2);
  kernel[7 * SIGN_FRAME_DIM * 2] = 10;
  return {
    labels: ['MESA', '_'],
    normalizationVersion: 2,
    inputDim: SIGN_INPUT_DIM,
    layers: [{ in: SIGN_INPUT_DIM, out: 2, activation: 'softmax', kernel, bias: Float32Array.from([-5, 0]) }],
  };
}

const body = () => {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, z: 0, visibility: 1 }));
  p[0] = { x: 0.5, y: 0.3, z: 0, visibility: 1 };
  p[11] = { x: 0.62, y: 0.55, z: 0, visibility: 1 };
  p[12] = { x: 0.38, y: 0.55, z: 0, visibility: 1 };
  return { landmarks: [p], worldLandmarks: [] };
};
const handAt = (x: number) => ({
  landmarks: [Array.from({ length: 21 }, (_, i) => ({ x: x + (i % 5) * 0.01, y: 0.45 - Math.floor(i / 5) * 0.015, z: 0 }))],
  handedness: [[{ categoryName: 'Left', score: 0.9, index: 0, displayName: '' }]],
  worldLandmarks: [],
  handednesses: [],
});

let latest: UseSignCameraRecognizerReturn | null = null;
function Probe({ target }: { target: string }) {
  const r = useSignCameraRecognizer(target);
  latest = r;
  const { start } = r;
  useEffect(() => { start(); }, [start]);
  return (<><video ref={r.videoRef} /><canvas ref={r.canvasRef} /></>);
}

let getUserMedia: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.spyOn>;
let frames: ((now: number) => void)[];

beforeEach(() => {
  latest = null;
  frames = [];
  resetHandLandmarkerForTests();
  resetPoseLandmarkerForTests();
  setSignModelForTests(null);
  handDetect.mockReset();
  poseDetect.mockReset();
  setOptions.mockClear();
  getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] }));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb: (now: number) => void) => { frames.push(cb); return frames.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
});

afterEach(() => {
  play.mockRestore();
  vi.unstubAllGlobals();
  setSignModelForTests(null);
});

describe('useSignCameraRecognizer', () => {
  it('sem modelo de sinais: fica indisponível e não abre a câmera', async () => {
    render(<Probe target="MESA" />);
    await waitFor(() => expect(latest?.status).toBe('unavailable'));
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('com modelo: duas mãos, corpo pelo modelo lite e câmera ligada', async () => {
    setSignModelForTests({ model: mesaModel() });
    const { PoseLandmarker } = await import('@mediapipe/tasks-vision');
    render(<Probe target="MESA" />);
    await waitFor(() => expect(latest?.status).toBe('active'));
    expect(setOptions).toHaveBeenCalledWith({ numHands: 2 });
    expect(vi.mocked(PoseLandmarker.createFromOptions).mock.calls.at(-1)?.[1]).toMatchObject({
      baseOptions: { modelAssetPath: POSE_MODEL_URL }, runningMode: 'VIDEO', numPoses: 1,
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('quadros com mão e corpo por 2 s viram a leitura da glosa', async () => {
    setSignModelForTests({ model: mesaModel() });
    const ready = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState');
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    try {
      let t = 0;
      handDetect.mockImplementation(() => handAt(0.4 + 0.05 * Math.sin(t / 150)));
      poseDetect.mockImplementation(() => body());
      render(<Probe target="MESA" />);
      await waitFor(() => expect(latest?.status).toBe('active'));
      expect(latest?.gloss).toBeNull();
      for (t = 0; t <= 2200; t += 1000 / 15) {
        const tick = frames.at(-1)!;
        act(() => tick(t));
      }
      expect(latest).toMatchObject({ handPresent: true, bodyPresent: true, gloss: 'MESA' });
      expect(latest!.targetProbability).toBeGreaterThan(0.99);
    } finally {
      getContext.mockRestore();
      if (ready) Object.defineProperty(HTMLMediaElement.prototype, 'readyState', ready);
    }
  });
});

describe('toSignFrame', () => {
  it('mãos com o rótulo do MediaPipe, corpo ou null, tempo em segundos', () => {
    const hands = handAt(0.4);
    const f = toSignFrame(1.5, hands as never, null);
    expect(f.t).toBe(1.5);
    expect(f.hands).toHaveLength(1);
    expect(f.hands[0].handedness).toBe('Left');
    expect(f.hands[0].landmarks).toHaveLength(21);
    expect(f.pose).toBeNull();
    expect(toSignFrame(0, { landmarks: [], handedness: [] } as never, body() as never).pose).toHaveLength(33);
  });
});
