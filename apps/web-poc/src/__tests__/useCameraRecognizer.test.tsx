import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useCameraRecognizer, type CamStatus } from '../hooks/useCameraRecognizer';
import { resetHandLandmarkerForTests } from '../recognition/landmarker';
import { setClassifierForTests, type Classifier } from '../recognition/classifier';

// MediaPipe fica fora do teste: so interessa o ciclo de vida da camera.
const landmarkerClose = vi.fn();
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: {
    createFromOptions: vi.fn(async () => ({ close: landmarkerClose, detectForVideo: vi.fn() })),
  },
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

function abortError() {
  return new DOMException('The play() request was interrupted by a call to pause().', 'AbortError');
}

let lastStatus: CamStatus = 'idle';

/** Igual aos exercicios de camera: liga a camera ao montar. */
function CameraProbe() {
  const { videoRef, canvasRef, status, start } = useCameraRecognizer();
  lastStatus = status;
  useEffect(() => { start(); }, [start]);
  return (
    <>
      <video ref={videoRef} />
      <canvas ref={canvasRef} />
    </>
  );
}

let getUserMedia: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.spyOn>;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  lastStatus = 'idle';
  // Cada teste comeca sem o landmarker da sessao (no app ele e criado uma vez e reaproveitado)
  resetHandLandmarkerForTests();
  const { HandLandmarker } = await import('@mediapipe/tasks-vision');
  vi.mocked(HandLandmarker.createFromOptions).mockClear();
  landmarkerClose.mockClear();
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play');
  consoleError = vi.spyOn(console, 'error');
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  play.mockRestore();
  consoleError.mockRestore();
  vi.unstubAllGlobals();
});

describe('useCameraRecognizer: exercicio pulado antes de a camera abrir', () => {
  it('para as tracks do stream que chega depois do unmount e nao segue o start', async () => {
    const media = deferred<MediaStream>();
    getUserMedia.mockReturnValue(media.promise);
    play.mockResolvedValue(undefined);

    const { unmount } = render(<CameraProbe />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    unmount();

    const { stream, track } = fakeStream();
    await act(async () => { media.resolve(stream); });

    expect(track.stop).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('ignora o AbortError do play quando o exercicio e desmontado no meio', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const playing = deferred<void>();
    play.mockReturnValue(playing.promise);

    const { unmount } = render(<CameraProbe />);
    await waitFor(() => expect(play).toHaveBeenCalled());
    unmount();
    await act(async () => { playing.reject(abortError()); });

    expect(track.stop).toHaveBeenCalled();
    // O landmarker e da sessao: sair do exercicio nao fecha o modelo
    expect(landmarkerClose).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('modelo que termina de carregar depois do unmount fica para a sessao e a camera nao e pedida', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    play.mockResolvedValue(undefined);
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const model = deferred<unknown>();
    vi.mocked(HandLandmarker.createFromOptions).mockReturnValueOnce(model.promise as never);

    const { unmount } = render(<CameraProbe />);
    await waitFor(() => expect(HandLandmarker.createFromOptions).toHaveBeenCalled());
    unmount();
    await act(async () => { model.resolve({ close: landmarkerClose }); });

    expect(landmarkerClose).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();

    // O proximo exercicio reaproveita o modelo que terminou de carregar
    render(<CameraProbe />);
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(HandLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
  });
});

describe('useCameraRecognizer: landmarker unico por sessao', () => {
  it('nao recria o modelo a cada exercicio', async () => {
    getUserMedia.mockImplementation(async () => fakeStream().stream);
    play.mockResolvedValue(undefined);
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');

    const first = render(<CameraProbe />);
    await waitFor(() => expect(lastStatus).toBe('active'));
    first.unmount();
    render(<CameraProbe />);
    await waitFor(() => expect(lastStatus).toBe('active'));

    expect(HandLandmarker.createFromOptions).toHaveBeenCalledTimes(1);
    expect(landmarkerClose).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

describe('useCameraRecognizer: componente montado', () => {
  it('AbortError no play nao vira erro: a camera fica ativa', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    play.mockRejectedValue(abortError());

    render(<CameraProbe />);
    await waitFor(() => expect(lastStatus).toBe('active'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('outros erros do play continuam indo para o estado de erro', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    play.mockRejectedValue(new DOMException('sem fonte', 'NotSupportedError'));
    consoleError.mockImplementation(() => {});

    render(<CameraProbe />);
    await waitFor(() => expect(lastStatus).toBe('error'));
  });

  it('permissao negada continua indo para denied', async () => {
    getUserMedia.mockRejectedValue(new DOMException('negado', 'NotAllowedError'));

    render(<CameraProbe />);
    await waitFor(() => expect(lastStatus).toBe('denied'));
  });
});

describe('useCameraRecognizer: laco de quadros', () => {
  type FrameCb = (now: number) => void;
  let frameCb: FrameCb | null = null;

  beforeEach(() => {
    frameCb = null;
    Object.defineProperty(HTMLVideoElement.prototype, 'requestVideoFrameCallback', {
      configurable: true,
      value: (cb: FrameCb) => { frameCb = cb; return 1; },
    });
    Object.defineProperty(HTMLVideoElement.prototype, 'cancelVideoFrameCallback', { configurable: true, value: () => {} });
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  afterEach(() => {
    for (const k of ['requestVideoFrameCallback', 'cancelVideoFrameCallback', 'videoWidth', 'videoHeight']) {
      delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[k];
    }
    delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).readyState;
    setClassifierForTests(null);
  });

  it('usa o classificador da sessao e atualiza a tela a no maximo 10 Hz', async () => {
    const hand = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.5 + i / 100, z: 0 }));
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    vi.mocked(HandLandmarker.createFromOptions).mockResolvedValueOnce({
      close: landmarkerClose,
      detectForVideo: vi.fn(() => ({ landmarks: [hand], handedness: [[{ categoryName: 'Left' }]] })),
    } as never);
    let n = 0;
    const classify = vi.fn(() => ({ letter: 'C', confidence: (n += 1) / 100, extensions: null as never }));
    const fake: Classifier = { kind: 'mlp', letters: new Set(['C']), classify };
    setClassifierForTests(fake);

    getUserMedia.mockResolvedValue(fakeStream().stream);
    play.mockResolvedValue(undefined);
    let renders = 0;
    let lastGesture: string | null = null;
    function Probe() {
      const { videoRef, canvasRef, start, rawGesture } = useCameraRecognizer();
      renders += 1;
      lastGesture = rawGesture;
      useEffect(() => { start(); }, [start]);
      return (<><video ref={videoRef} /><canvas ref={canvasRef} /></>);
    }

    render(<Probe />);
    await waitFor(() => expect(frameCb).not.toBeNull());
    const before = renders;
    // 2 s de camera a 30 fps: o laco processa 15 por segundo e a tela recebe no maximo 10 por segundo
    // (um act por quadro: cada atualizacao vira um render, como no navegador)
    for (let i = 0; i < 60; i++) {
      await act(async () => { frameCb?.(1000 + i * (1000 / 30)); });
    }

    expect(classify).toHaveBeenCalledTimes(30);
    expect((classify.mock.calls[0] as unknown[])[1]).toEqual({ handedness: 'Left', aspect: 640 / 480 });
    expect(renders - before).toBeLessThanOrEqual(21);
    expect(renders - before).toBeGreaterThanOrEqual(10);
    expect(lastGesture).toBe('C');
  });
});
