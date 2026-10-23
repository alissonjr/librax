import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { useCameraRecognizer, type CamStatus } from '../hooks/useCameraRecognizer';

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

beforeEach(() => {
  lastStatus = 'idle';
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
    expect(landmarkerClose).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('fecha o modelo carregado depois do unmount sem pedir a camera', async () => {
    getUserMedia.mockResolvedValue(fakeStream().stream);
    const { HandLandmarker } = await import('@mediapipe/tasks-vision');
    const model = deferred<unknown>();
    vi.mocked(HandLandmarker.createFromOptions).mockReturnValueOnce(model.promise as never);

    const { unmount } = render(<CameraProbe />);
    await waitFor(() => expect(HandLandmarker.createFromOptions).toHaveBeenCalled());
    unmount();
    await act(async () => { model.resolve({ close: landmarkerClose }); });

    expect(landmarkerClose).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
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
