import { describe, it, expect, vi, afterEach } from 'vitest';
import { startFrameLoop } from '../recognition/frameLoop';

/** Vídeo falso com requestVideoFrameCallback controlado pelo teste. */
function fakeVideo() {
  let pending: ((now: number) => void) | null = null;
  const video = {
    requestVideoFrameCallback: vi.fn((cb: (now: number) => void) => { pending = cb; return 1; }),
    cancelVideoFrameCallback: vi.fn(() => { pending = null; }),
  } as unknown as HTMLVideoElement;
  const frame = (now: number) => { const cb = pending; pending = null; cb?.(now); };
  return { video, frame, hasPending: () => pending !== null };
}

afterEach(() => vi.unstubAllGlobals());

describe('startFrameLoop', () => {
  it('limita a 15 fps uma câmera de 30 fps', () => {
    const { video, frame } = fakeVideo();
    const onFrame = vi.fn();
    const stop = startFrameLoop(video, onFrame, { maxFps: 15 });
    for (let i = 0; i < 60; i++) frame(i * (1000 / 30)); // 2 s de câmera
    stop();
    expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(onFrame.mock.calls.length).toBeLessThanOrEqual(31);
  });

  it('mantém a média de 15 fps com câmera de 24 fps (não arredonda para 12)', () => {
    const { video, frame } = fakeVideo();
    const onFrame = vi.fn();
    startFrameLoop(video, onFrame, { maxFps: 15 });
    for (let i = 0; i < 96; i++) frame(i * (1000 / 24)); // 4 s
    expect(onFrame.mock.calls.length).toBeGreaterThanOrEqual(58);
    expect(onFrame.mock.calls.length).toBeLessThanOrEqual(62);
  });

  it('descarta quadros enquanto o anterior ainda processa', async () => {
    const { video, frame } = fakeVideo();
    let release!: () => void;
    const onFrame = vi.fn(() => new Promise<void>(res => { release = res; }));
    startFrameLoop(video, onFrame, { maxFps: 15 });
    frame(0);
    frame(100);
    frame(200);
    expect(onFrame).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    frame(300);
    expect(onFrame).toHaveBeenCalledTimes(2);
  });

  it('para de agendar depois do stop', () => {
    const { video, frame, hasPending } = fakeVideo();
    const onFrame = vi.fn();
    const stop = startFrameLoop(video, onFrame);
    stop();
    expect(video.cancelVideoFrameCallback).toHaveBeenCalled();
    frame(0);
    expect(onFrame).not.toHaveBeenCalled();
    expect(hasPending()).toBe(false);
  });

  it('cai para requestAnimationFrame sem requestVideoFrameCallback', () => {
    const raf = vi.fn(() => 7);
    const caf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);
    const stop = startFrameLoop({} as HTMLVideoElement, vi.fn());
    expect(raf).toHaveBeenCalledTimes(1);
    stop();
    expect(caf).toHaveBeenCalledWith(7);
  });
});
