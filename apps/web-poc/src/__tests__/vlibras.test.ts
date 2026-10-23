import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  attachVlibras,
  getVlibrasState,
  play,
  __resetVlibrasForTests,
} from '../lib/vlibras';

function frame() {
  return document.querySelector<HTMLIFrameElement>('.vlibras-frame');
}

/** Simula uma mensagem da página-ponte (mesma origem, vinda do iframe). */
function fromBridge(event: string, data?: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: 'vlibras_event', event, data },
      origin: window.location.origin,
      source: frame()!.contentWindow,
    }),
  );
}

type Sent = { type: string; method?: string; params?: unknown };

function sentMethods(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([raw]) => {
    const m = raw as Sent;
    return m.type === 'unity' ? `${m.method}:${m.params ?? ''}` : m.type;
  });
}

describe('player VLibras (instância única)', () => {
  beforeEach(() => {
    __resetVlibrasForTests();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  });
  afterEach(() => {
    __resetVlibrasForTests();
    vi.unstubAllGlobals();
  });

  it('não cria nada até um exercício pedir o avatar', () => {
    expect(frame()).toBeNull();
    expect(getVlibrasState().status).toBe('idle');
  });

  it('cria um iframe só, reaproveitado entre encaixes', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    const detachA = attachVlibras(a);
    expect(frame()).not.toBeNull();
    expect(frame()!.getAttribute('src')).toBe('/vlibras/player.html');
    detachA();
    attachVlibras(b);
    expect(document.querySelectorAll('.vlibras-frame')).toHaveLength(1);
    expect(getVlibrasState().status).toBe('loading');
  });

  it('desliga a legenda ao carregar e antes de cada glosa', async () => {
    attachVlibras(document.createElement('div'));
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    fromBridge('update_progress', 0.5);
    expect(getVlibrasState().progress).toBe(0.5);
    fromBridge('on_load_player');
    expect(getVlibrasState().status).toBe('ready');
    expect(sentMethods(post)).toContain('setSubtitlesState:0');

    post.mockClear();
    const started = play('BOM TARDE');
    await vi.waitFor(() => expect(sentMethods(post)).toContain('playNow:BOM TARDE'));
    const calls = sentMethods(post);
    expect(calls.indexOf('setSubtitlesState:0')).toBeLessThan(calls.indexOf('playNow:BOM TARDE'));
    // cada glosa da sequência é conferida antes
    expect(fetch).toHaveBeenCalledTimes(2);
    fromBridge('on_playing_state_change', ['True', 'False', 'False', 'False', 'True']);
    await expect(started).resolves.toBe(true);
  });

  it('não toca se a animação não vier (evita a soletração que entregaria a resposta)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    attachVlibras(document.createElement('div'));
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    fromBridge('on_load_player');
    post.mockClear();
    await expect(play('BANANA')).resolves.toBe(false);
    expect(sentMethods(post).some((m) => m.startsWith('playNow'))).toBe(false);
  });

  it('pausa o laço do Unity ao desencaixar (GPU livre para a câmera)', () => {
    const detach = attachVlibras(document.createElement('div'));
    const post = vi.spyOn(frame()!.contentWindow!, 'postMessage');
    fromBridge('on_load_player');
    post.mockClear();
    detach();
    expect(sentMethods(post)).toEqual(['stopAll:', 'pause_loop']);
  });

  it('erro da página-ponte vira estado de falha e descarta o iframe', () => {
    attachVlibras(document.createElement('div'));
    fromBridge('on_error', 'loader');
    expect(getVlibrasState().status).toBe('error');
    expect(frame()).toBeNull();
  });

  it('sem progresso por muito tempo conta como servidor fora do ar', () => {
    vi.useFakeTimers();
    try {
      attachVlibras(document.createElement('div'));
      vi.advanceTimersByTime(21_000);
      expect(getVlibrasState().status).toBe('error');
    } finally {
      vi.useRealTimers();
    }
  });
});
