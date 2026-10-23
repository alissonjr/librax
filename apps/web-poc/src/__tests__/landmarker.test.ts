import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectHands, getHandLandmarker, peekHandLandmarker, recreateHandLandmarker, resetHandLandmarkerForTests,
} from '../recognition/landmarker';
import { HAND_MODEL_URL, MEDIAPIPE_VERSION, MEDIAPIPE_WASM_DIR } from '../recognition/mlAssets';
import pkg from '../../package.json';

const close = vi.fn();
const detectForVideo = vi.fn(() => ({ landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] }));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({ wasm: true })) },
  HandLandmarker: { createFromOptions: vi.fn(async () => ({ close, detectForVideo })) },
}));

beforeEach(async () => {
  resetHandLandmarkerForTests();
  close.mockClear();
  detectForVideo.mockClear();
  const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
  vi.mocked(HandLandmarker.createFromOptions).mockClear();
  vi.mocked(FilesetResolver.forVisionTasks).mockClear();
});

describe('arquivos de ML servidos pelo app', () => {
  it('a versão do caminho /ml/ é a do pacote instalado (JS e WASM iguais)', () => {
    expect(pkg.dependencies['@mediapipe/tasks-vision']).toBe(MEDIAPIPE_VERSION);
    expect(MEDIAPIPE_WASM_DIR).toBe(`/ml/${MEDIAPIPE_VERSION}/wasm`);
    expect(HAND_MODEL_URL).toBe(`/ml/${MEDIAPIPE_VERSION}/hand_landmarker.task`);
  });
});

describe('landmarker da sessão', () => {
  it('cria uma vez só e reaproveita entre chamadas (não recria por exercício)', async () => {
    const { HandLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
    const a = await getHandLandmarker();
    const b = await getHandLandmarker();
    expect(a).toBe(b);
    expect(HandLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
    expect(FilesetResolver.forVisionTasks).toHaveBeenCalledWith(MEDIAPIPE_WASM_DIR);
    expect(vi.mocked(HandLandmarker.createFromOptions).mock.calls[0][1]).toMatchObject({
      baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    expect(a.load.kind).toBe('cold');
    expect(peekHandLandmarker()).toBe(a);
  });

  it('cai para CPU quando a GPU falha', async () => {
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    vi.mocked(HandLandmarker.createFromOptions).mockRejectedValueOnce(new Error('sem WebGL2'));
    const h = await getHandLandmarker();
    expect(h.delegate).toBe('CPU');
    expect(h.load.gpuError).toBe('sem WebGL2');
  });

  it('tenta de novo depois de uma falha', async () => {
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    vi.mocked(HandLandmarker.createFromOptions)
      .mockRejectedValueOnce(new Error('rede'))
      .mockRejectedValueOnce(new Error('rede'));
    await expect(getHandLandmarker()).rejects.toThrow('rede');
    const h = await getHandLandmarker();
    expect(h.delegate).toBe('GPU');
  });

  it('recriar fecha o anterior e mede como carga a quente', async () => {
    await getHandLandmarker();
    const h = await recreateHandLandmarker('CPU');
    expect(close).toHaveBeenCalledTimes(1);
    expect(h.delegate).toBe('CPU');
    expect(h.load.kind).toBe('warm');
  });

  it('timestamps do detectForVideo sempre crescentes', async () => {
    const h = await getHandLandmarker();
    const video = {} as HTMLVideoElement;
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    detectHands(h, video);
    detectHands(h, video);
    const ts = detectForVideo.mock.calls.map(c => (c as unknown[])[1] as number);
    expect(ts[1]).toBeGreaterThan(ts[0]);
    now.mockRestore();
  });
});
