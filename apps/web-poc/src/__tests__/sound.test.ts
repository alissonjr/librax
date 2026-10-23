import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  play, Sfx, unlockAudio, installSoundUnlock, setSoundEnabled, getSoundPref, isSoundEnabled,
  soundSpec, soundUrl, stopAll, onSoundPrefChange, SOUND_EVENTS, __resetSoundForTests,
} from '../lib/sound';
import { synthesize } from '../lib/sfxSynth.js';
import { tokens } from '../styles/tokens';

// ---------- AudioContext falso ----------

class FakeBuffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  private data: Float32Array[];
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  getChannelData(ch: number) {
    return this.data[ch];
  }
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect = vi.fn();
  start = vi.fn(() => {
    this.started = true;
  });
  stop = vi.fn(() => {
    this.stopped = true;
  });
  /** Simula o fim natural do som. */
  end() {
    this.onended?.();
  }
}

class FakeContext {
  static instances: FakeContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  sampleRate = 8000;
  destination = {};
  sources: FakeSource[] = [];
  decodeAudioData = vi.fn(async () => {
    // "Arquivo" decodificado com 10 amostras de silêncio do encoder antes do som
    const b = new FakeBuffer(1, 40, this.sampleRate);
    b.getChannelData(0).fill(0.5, 10);
    return b;
  });
  constructor() {
    FakeContext.instances.push(this);
  }
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn() };
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  /** Sons que de fato começaram (ignora o quadro de silêncio do destravamento). */
  played() {
    return this.sources.filter(s => s.started && s.buffer && s.buffer.length > 1);
  }
}

function ctx() {
  return FakeContext.instances[FakeContext.instances.length - 1];
}

const fetchFail = vi.fn(async () => {
  throw new Error('offline');
});

beforeEach(() => {
  __resetSoundForTests();
  localStorage.clear();
  FakeContext.instances = [];
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeContext;
  vi.stubGlobal('fetch', fetchFail);
  document.documentElement.removeAttribute('data-reduced-motion');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (navigator as unknown as { audioSession?: unknown }).audioSession;
});

async function enableAndUnlock() {
  setSoundEnabled(true);
  await unlockAudio();
}

describe('preferência de som', () => {
  it('começa sem escolha e desligado (decisão: perguntar no onboarding)', () => {
    expect(getSoundPref()).toBeNull();
    expect(isSoundEnabled()).toBe(false);
  });

  it('grava a escolha e avisa os ouvintes', () => {
    const fn = vi.fn();
    onSoundPrefChange(fn);
    setSoundEnabled(true);
    expect(getSoundPref()).toBe('on');
    expect(fn).toHaveBeenCalledWith(true);
    setSoundEnabled(false);
    expect(getSoundPref()).toBe('off');
    expect(fn).toHaveBeenLastCalledWith(false);
  });

  it('com o som desligado não cria AudioContext nem toca', async () => {
    await unlockAudio();
    expect(FakeContext.instances).toHaveLength(0);
    expect(play('correct')).toBe(false);
  });
});

describe('destravamento', () => {
  it('nada toca antes do primeiro toque do usuário', () => {
    setSoundEnabled(true);
    // setSoundEnabled destrava, mas o contexto ainda não está carregado neste tique
    expect(play('correct')).toBe(false);
  });

  it('destrava no primeiro gesto e usa a sessão de áudio ambient quando existe', async () => {
    const session = { type: 'auto' };
    (navigator as unknown as { audioSession: unknown }).audioSession = session;
    localStorage.setItem('librax_sound', 'on');
    installSoundUnlock();
    window.dispatchEvent(new Event('pointerdown'));
    await vi.waitFor(() => expect(ctx()?.state).toBe('running'));
    expect(session.type).toBe('ambient');
    expect(ctx().resume).toHaveBeenCalled();
    await unlockAudio();
    expect(play('correct')).toBe(true);
  });

  it('busca os arquivos .m4a e corta o silêncio inicial do encoder', async () => {
    const ok = vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
    vi.stubGlobal('fetch', ok);
    await enableAndUnlock();
    expect(ok).toHaveBeenCalledWith(soundUrl('correct'));
    expect(soundUrl('correct')).toBe('/audio/sfx_correct_soft.m4a');
    play('correct');
    const buf = ctx().played()[0].buffer!;
    expect(buf.length).toBe(30);
    expect(buf.getChannelData(0)[0]).toBe(0.5);
  });

  it('sem os arquivos, sintetiza os buffers em tempo de execução', async () => {
    await enableAndUnlock();
    expect(fetchFail).toHaveBeenCalled();
    expect(ctx().decodeAudioData).not.toHaveBeenCalled();
    expect(play('lessonDone')).toBe(true);
    const buf = ctx().played()[0].buffer!;
    expect(buf.length).toBe(Math.round((soundSpec('lessonDone').durationMs / 1000) * 8000));
  });
});

describe('fila de prioridade (spec-05 3.2)', () => {
  beforeEach(enableAndUnlock);

  it('nunca toca dois sons ao mesmo tempo: menor prioridade é descartada', () => {
    expect(Sfx.lessonDone()).toBe(true);
    expect(Sfx.correct()).toBe(false);
    expect(ctx().played()).toHaveLength(1);
  });

  it('prioridade maior interrompe a atual', () => {
    Sfx.correct();
    const first = ctx().played()[0];
    expect(Sfx.achievement()).toBe(true);
    expect(first.stopped).toBe(true);
    expect(ctx().played()).toHaveLength(2);
  });

  it('mesma prioridade entra na fila e toca quando a atual termina (FIFO)', () => {
    Sfx.achievement();
    expect(Sfx.leagueUp()).toBe(true); // ambos prioridade 6
    expect(ctx().played()).toHaveLength(1);
    ctx().played()[0].end();
    const played = ctx().played();
    expect(played).toHaveLength(2);
    expect(played[1].buffer!.length).toBe(Math.round(0.9 * 8000));
  });

  it('sons de interface são cancelados quando uma celebração começa', () => {
    Sfx.advance();
    const ui = ctx().played()[0];
    expect(Sfx.xpTick()).toBe(false); // interface não entra na fila
    Sfx.courseDone();
    expect(ui.stopped).toBe(true);
  });

  it('a ordem de prioridade segue os tokens', () => {
    const p = (e: Parameters<typeof soundSpec>[0]) => soundSpec(e).priority;
    expect(p('courseDone')).toBeGreaterThan(p('unitDone'));
    expect(p('unitDone')).toBeGreaterThan(p('achievement'));
    expect(p('achievement')).toBeGreaterThan(p('lessonDone'));
    expect(p('lessonDone')).toBeGreaterThan(p('goalMet'));
    expect(p('goalMet')).toBeGreaterThan(p('streak'));
    expect(p('streak')).toBeGreaterThan(p('correct'));
    expect(p('neutral')).toBe(0);
  });

  it('desligar o som para o que estiver tocando', () => {
    Sfx.unitDone();
    const s = ctx().played()[0];
    setSoundEnabled(false);
    expect(s.stopped).toBe(true);
    expect(Sfx.correct()).toBe(false);
  });

  it('stopAll esvazia a fila', () => {
    Sfx.achievement();
    Sfx.leagueUp();
    stopAll();
    expect(Sfx.correct()).toBe(true);
  });
});

describe('modo reduzido', () => {
  beforeEach(enableAndUnlock);

  it('não toca sons de interface, mas mantém acerto e celebração', () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    expect(Sfx.neutral()).toBe(false);
    expect(Sfx.advance()).toBe(false);
    expect(Sfx.correct()).toBe(true);
  });
});

describe('síntese', () => {
  it('tem receita para todo evento dos tokens, com a duração do token e sem estourar', () => {
    const keys = Object.keys(tokens).filter(k => k.startsWith('sound.')).map(k => k.slice(6));
    expect([...keys].sort()).toEqual([...SOUND_EVENTS].sort());
    for (const ev of SOUND_EVENTS) {
      const { durationMs } = soundSpec(ev);
      const s = synthesize(ev, 8000, durationMs);
      expect(s.length).toBe(Math.round((durationMs / 1000) * 8000));
      let peak = 0;
      for (const v of s) peak = Math.max(peak, Math.abs(v));
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  it('é determinística (o mesmo som em todo aparelho)', () => {
    expect(synthesize('neutral', 8000, 200)).toEqual(synthesize('neutral', 8000, 200));
  });
});
