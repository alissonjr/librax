import { tokens } from '../styles/tokens';
import { synthesize } from './sfxSynth.js';

/**
 * Som do Librax (spec-05 seção 3, design system seção 10.3, plano mobile web decisão 12).
 *
 * Regras:
 * - Som é camada opcional. Nenhum som carrega informação que não esteja na tela: o público inclui
 *   pessoas surdas, e quem usa no mudo tem a experiência completa.
 * - Erro nunca toca som negativo: o evento `neutral` é um sopro suave, sem timbre de "errado".
 * - Web Audio API com AudioBuffers prontos antes do primeiro disparo (latência baixa). O contexto
 *   só é criado e destravado no primeiro toque do usuário; antes disso nada toca e nada quebra.
 * - Arquivos AAC (.m4a) em public/audio, gerados por síntese em tools/audio/build.mjs (OGG falha
 *   no Safari). Se um arquivo não carregar ou não decodificar, o buffer é sintetizado na hora com
 *   o mesmo código (src/lib/sfxSynth.js), então o som existe mesmo sem os arquivos.
 * - Onde existir `navigator.audioSession`, usa o tipo 'ambient': respeita a chave de silencioso do
 *   iPhone e não interrompe a música da pessoa.
 * - Nunca dois sons ao mesmo tempo (fila de prioridade da spec-05 seção 3.2, ver `play`).
 * - Preferência "Sons" nas Configurações. Padrão (design system, "Decisões aplicadas" item 4):
 *   perguntar no onboarding; enquanto a pessoa não escolheu, o som fica desligado.
 * - Modo reduzido (prefers-reduced-motion ou "Reduzir animações" do app, `data-reduced-motion`):
 *   os sons de interface de prioridade 0 (clique, tique de XP, sopro do erro) não tocam; os de
 *   acerto e celebração continuam se o som estiver ligado.
 */

export type SoundEvent =
  | 'correct'
  | 'correctCamera'
  | 'neutral'
  | 'advance'
  | 'xpTick'
  | 'streak'
  | 'goalMet'
  | 'lessonDone'
  | 'achievement'
  | 'unitDone'
  | 'courseDone'
  | 'freeze'
  | 'leagueUp';

export const SOUND_EVENTS: readonly SoundEvent[] = [
  'correct', 'correctCamera', 'neutral', 'advance', 'xpTick', 'streak', 'goalMet',
  'lessonDone', 'achievement', 'unitDone', 'courseDone', 'freeze', 'leagueUp',
];

interface SoundToken { file: string; priority: number; durationMs: number }

/** Token sound.<evento> (arquivo, prioridade e duração). */
export function soundSpec(event: SoundEvent): SoundToken {
  return tokens[`sound.${event}`] as SoundToken;
}

/** Caminho do arquivo AAC do evento (public/audio). */
export function soundUrl(event: SoundEvent): string {
  return `/audio/${soundSpec(event).file}.m4a`;
}

// ---------- preferência ----------

const PREF_KEY = 'librax_sound';
export type SoundPref = 'on' | 'off';

/** 'on' | 'off', ou null quando a pessoa ainda não escolheu (tratado como desligado). */
export function getSoundPref(): SoundPref | null {
  try {
    const v = localStorage.getItem(PREF_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function isSoundEnabled(): boolean {
  return getSoundPref() === 'on';
}

type Listener = (enabled: boolean) => void;
const listeners = new Set<Listener>();

/** Avisa quando a preferência muda (Configurações e onboarding usam o mesmo estado). */
export function onSoundPrefChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Grava a preferência. Chamada dentro de um toque (o próprio interruptor), aproveita o gesto
 * para destravar o áudio; ao desligar, para o que estiver tocando.
 */
export function setSoundEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
  } catch {
    /* segue só na sessão */
  }
  if (enabled) void unlockAudio();
  else stopAll();
  listeners.forEach(fn => fn(enabled));
}

function reducedMode(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.getAttribute('data-reduced-motion') === 'true') {
    return true;
  }
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------- contexto e buffers ----------

type AudioContextCtor = new () => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const buffers = new Map<SoundEvent, AudioBuffer>();
let loading: Promise<void> | null = null;

/** Volume geral: os sons reforçam, não competem com a tela. */
const MASTER_GAIN = 0.7;

/** Tipo 'ambient' na sessão de áudio (Safari 17+): mudo do iPhone manda e a música continua. */
function setAmbientSession(): void {
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    /* recurso opcional */
  }
}

/** Remove o silêncio do começo (o encoder AAC acrescenta ~46 ms de "priming"). */
function trimLeadingSilence(c: AudioContext, buf: AudioBuffer, threshold = 0.002): AudioBuffer {
  const data = buf.getChannelData(0);
  let start = 0;
  while (start < data.length && Math.abs(data[start]) < threshold) start++;
  if (start === 0 || start >= data.length) return buf;
  const out = c.createBuffer(buf.numberOfChannels, buf.length - start, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(start));
  }
  return out;
}

function synthBuffer(c: AudioContext, event: SoundEvent): AudioBuffer {
  const samples = synthesize(event, c.sampleRate, soundSpec(event).durationMs);
  const buf = c.createBuffer(1, samples.length, c.sampleRate);
  buf.getChannelData(0).set(samples);
  return buf;
}

async function loadBuffer(c: AudioContext, event: SoundEvent): Promise<AudioBuffer> {
  try {
    const res = await fetch(soundUrl(event));
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.arrayBuffer();
    const decoded = await c.decodeAudioData(data);
    return trimLeadingSilence(c, decoded);
  } catch {
    // Sem arquivo (offline no primeiro acesso, 404, codec): sintetiza o mesmo som aqui
    return synthBuffer(c, event);
  }
}

function loadAll(c: AudioContext): Promise<void> {
  if (!loading) {
    loading = Promise.all(
      SOUND_EVENTS.map(async ev => {
        buffers.set(ev, await loadBuffer(c, ev));
      }),
    ).then(() => undefined);
  }
  return loading;
}

/**
 * Cria (se preciso) e destrava o AudioContext. Precisa rodar dentro de um gesto do usuário
 * (toque, clique, tecla): é o que o Safari iOS e o Chrome Android exigem para tocar.
 * Só cria o contexto com o som ligado; com ele desligado nada é carregado.
 */
export async function unlockAudio(): Promise<void> {
  if (!isSoundEnabled()) return;
  const Ctor = audioContextCtor();
  if (!Ctor) return;
  try {
    if (!ctx) {
      setAmbientSession();
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    }
    if (ctx.state !== 'running') {
      // iOS antigo só libera a saída depois de tocar algo dentro do gesto: um quadro em silêncio
      const silent = ctx.createBufferSource();
      silent.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      silent.connect(ctx.destination);
      silent.start(0);
      await ctx.resume();
    }
    await loadAll(ctx);
  } catch {
    /* som é opcional: falha aqui só deixa o app em silêncio */
  }
}

let installed = false;

/**
 * Liga o destravamento ao primeiro gesto do usuário e o refaz quando o sistema suspende o áudio
 * (o iOS põe o contexto em "interrupted" numa ligação ou ao trocar de app).
 * Chamar uma vez na inicialização do app (main.tsx).
 */
export function installSoundUnlock(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const onGesture = () => {
    void unlockAudio();
  };
  for (const type of ['pointerdown', 'touchend', 'keydown'] as const) {
    window.addEventListener(type, onGesture, { capture: true, passive: true });
  }
}

// ---------- fila de prioridade (spec-05 seção 3.2) ----------

interface Playing {
  event: SoundEvent;
  priority: number;
  source: AudioBufferSourceNode;
}

interface Pending {
  event: SoundEvent;
  at: number;
}

let current: Playing | null = null;
let queue: Pending[] = [];

/** Itens da fila mais velhos que isso perdem o sentido (o momento na tela já passou). */
const QUEUE_MAX_AGE_MS = 2500;
const QUEUE_MAX = 3;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function start(event: SoundEvent): boolean {
  if (!ctx || !master) return false;
  const buffer = buffers.get(event);
  if (!buffer) return false;
  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(master);
    const playing: Playing = { event, priority: soundSpec(event).priority, source };
    source.onended = () => {
      if (current !== playing) return;
      current = null;
      next();
    };
    current = playing;
    source.start(0);
    return true;
  } catch {
    current = null;
    return false;
  }
}

function next(): void {
  const t = now();
  queue = queue.filter(p => t - p.at <= QUEUE_MAX_AGE_MS);
  const item = queue.shift();
  if (item) start(item.event);
}

function stopCurrent(): void {
  if (!current) return;
  const { source } = current;
  current = null;
  source.onended = null;
  try {
    source.stop();
  } catch {
    /* já tinha parado */
  }
}

/** Para o som atual e esvazia a fila (ao desligar o som). */
export function stopAll(): void {
  queue = [];
  stopCurrent();
}

/**
 * Toca um evento respeitando a preferência, o modo reduzido e a fila:
 * - nada tocando: toca;
 * - prioridade maior que a do som atual: interrompe o atual, descarta da fila o que tiver
 *   prioridade menor que a do novo (os sons de interface somem quando uma celebração começa)
 *   e toca o novo;
 * - mesma prioridade (acima de 0): entra na fila FIFO e toca quando o atual terminar;
 * - prioridade menor, ou som de interface (0) com algo tocando: descartado.
 *
 * Devolve true se o som começou ou entrou na fila. Nunca lança erro.
 */
export function play(event: SoundEvent): boolean {
  if (!isSoundEnabled()) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  const priority = soundSpec(event).priority;
  if (priority === 0 && reducedMode()) return false;
  if (!ctx || ctx.state !== 'running' || !buffers.has(event)) return false;

  if (!current) return start(event);

  if (priority > current.priority) {
    queue = queue.filter(p => soundSpec(p.event).priority >= priority);
    stopCurrent();
    return start(event);
  }
  if (priority === current.priority && priority > 0) {
    if (queue.length >= QUEUE_MAX) return false;
    queue.push({ event, at: now() });
    return true;
  }
  return false;
}

/** Atalhos por evento, no mesmo formato de `Haptics` (src/lib/haptics.ts). */
export const Sfx = {
  correct: () => play('correct'),
  correctCamera: () => play('correctCamera'),
  /** Erro: sopro neutro, nunca um som negativo. */
  neutral: () => play('neutral'),
  advance: () => play('advance'),
  xpTick: () => play('xpTick'),
  streak: () => play('streak'),
  goalMet: () => play('goalMet'),
  lessonDone: () => play('lessonDone'),
  achievement: () => play('achievement'),
  unitDone: () => play('unitDone'),
  courseDone: () => play('courseDone'),
  freeze: () => play('freeze'),
  leagueUp: () => play('leagueUp'),
};

/** Só para testes: volta o módulo ao estado inicial. */
export function __resetSoundForTests(): void {
  stopAll();
  ctx = null;
  master = null;
  buffers.clear();
  loading = null;
  installed = false;
  listeners.clear();
}
