/**
 * Player do avatar VLibras (Governo Federal, LGPL-3.0) com uma instância só para o app.
 *
 * Como funciona:
 * - O Unity roda num iframe da mesma origem (public/vlibras/player.html), que carrega o
 *   player oficial sem alteração. Player e animações são servidos pelo próprio app
 *   (scripts/vlibras-assets.mjs copia para public/vlibras/), sem depender dos servidores do
 *   governo, que são lentos e às vezes ficam fora do ar.
 * - O iframe é criado só quando um exercício pede o avatar (carregamento preguiçoso) e fica
 *   num contêiner fixo no <body>. Mover um iframe no DOM recarrega o Unity, então ele nunca
 *   sai do lugar: cada exercício registra um "encaixe" (slot) e o contêiner se posiciona por
 *   cima dele a cada quadro. Assim a mesma instância serve a todos os exercícios.
 * - Sem encaixe, o laço de renderização do Unity é pausado (pauseMainLoop) e o iframe sai da
 *   tela: o avatar não disputa a GPU com a detecção de mão da câmera.
 * - Depois de um tempo sem uso o iframe é descartado para devolver a memória (o Unity reserva
 *   256 MB). O próximo uso recarrega do cache.
 *
 * Mensagens: as mesmas do player oficial (objeto PlayerManager: playNow, setSlider,
 * setSubtitlesState, setBaseUrl, stopAll). A legenda é sempre desligada antes de tocar,
 * porque ela escreve a glosa por cima do avatar e entregaria a resposta.
 */

export const VLIBRAS_SITE_URL = 'https://www.vlibras.gov.br/';
export const VLIBRAS_LICENSE_URL = 'https://www.gnu.org/licenses/lgpl-3.0.html';
/**
 * Animações estáticas (as mesmas que o widget usa em playStatic), copiadas do dicionário do
 * VLibras por scripts/vlibras-assets.mjs. A pasta tem a BUNDLES_VERSION do script.
 */
export const VLIBRAS_BUNDLES_PATH = '/vlibras/sinais/2018.3.1/';

/** Pasta do player (a mesma BASE de public/vlibras/player.html e PLAYER_VERSION do script). */
export const VLIBRAS_PLAYER_PATH = '/vlibras/v7.12.2/';
/**
 * Arquivos do player com o tamanho da versão fixada (conferidos pelo SHA-256 do
 * scripts/vlibras-manifest.json), para o download de "usar offline" (lib/offlinePack.ts).
 */
export const VLIBRAS_PLAYER_FILES: readonly { name: string; bytes: number }[] = [
  { name: 'unity-loader.js', bytes: 150_016 },
  { name: 'playerweb.json', bytes: 464 },
  { name: 'playerweb.wasm.framework.unityweb', bytes: 76_883 },
  { name: 'playerweb.wasm.code.unityweb', bytes: 2_996_753 },
  { name: 'playerweb.data.unityweb', bytes: 16_992_528 },
];

/** URL absoluta das animações: o Unity recebe pelo setBaseUrl e monta baseUrl + glosa. */
function bundlesUrl(): string {
  return new URL(VLIBRAS_BUNDLES_PATH, window.location.origin).href;
}

/** Velocidades oferecidas: normal e as duas lentas da seção 12.1 do design system. */
export const VLIBRAS_SPEEDS = [1, 0.75, 0.5] as const;
export type VlibrasSpeed = (typeof VLIBRAS_SPEEDS)[number];

export type VlibrasStatus = 'idle' | 'loading' | 'ready' | 'error';
export type VlibrasErrorReason = 'offline' | 'unavailable' | 'unsupported' | 'timeout';

export interface VlibrasState {
  status: VlibrasStatus;
  /** 0 a 1, enquanto baixa o player. */
  progress: number;
  /** Tocando uma glosa agora. */
  playing: boolean;
  speed: VlibrasSpeed;
  error: VlibrasErrorReason | null;
}

const PLAYER_OBJECT = 'PlayerManager';
/** Sem nenhum sinal de progresso nesse tempo, considera o servidor fora do ar. */
const STALL_MS = 20_000;
/** Depois de baixar, o Unity ainda inicializa; em celular fraco leva alguns segundos. */
const INIT_MS = 45_000;
/** Tempo máximo entre pedir uma glosa e ela começar a tocar. */
const PLAY_START_MS = 15_000;
/** Sem encaixe por esse tempo, o iframe é descartado para liberar memória. */
const IDLE_DISPOSE_MS = 120_000;
/** Elementos do app que ficam por cima do avatar (o iframe é recortado onde eles aparecem). */
const OCCLUDERS = '.feedback-bar, .lesson-topbar';

type Listener = () => void;

let state: VlibrasState = { status: 'idle', progress: 0, playing: false, speed: 1, error: null };
const listeners = new Set<Listener>();

let host: HTMLDivElement | null = null;
let frame: HTMLIFrameElement | null = null;
let slot: HTMLElement | null = null;
let rafId = 0;
let loadTimer: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let pending: { glosses: string; resolve: (ok: boolean) => void } | null = null;
let playStart: { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> } | null = null;
let loopPaused = false;
let lastBox = '';

function setState(patch: Partial<VlibrasState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getVlibrasState(): VlibrasState {
  return state;
}

export function subscribeVlibras(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Página-ponte em public/ (o app é servido na raiz, sem `base` no vite.config). */
const BRIDGE_URL = '/vlibras/player.html';

function post(message: Record<string, unknown>) {
  frame?.contentWindow?.postMessage(message, window.location.origin);
}

function send(method: string, params?: unknown) {
  post({ type: 'unity', object: PLAYER_OBJECT, method, params });
}

function pauseLoop() {
  if (state.status !== 'ready' || loopPaused) return;
  send('stopAll');
  post({ type: 'pause_loop' });
  loopPaused = true;
}

function resumeLoop() {
  if (state.status !== 'ready' || !loopPaused) return;
  post({ type: 'resume_loop' });
  loopPaused = false;
}

function armLoadTimer(ms: number) {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => fail('timeout'), ms);
}

function fail(reason: VlibrasErrorReason) {
  clearTimeout(loadTimer);
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  dispose();
  setState({ status: 'error', error: offline ? 'offline' : reason, playing: false });
  pending?.resolve(false);
  pending = null;
  // A internet voltou: o próximo exercício com avatar tenta carregar de novo
  window.addEventListener('online', onOnline, { once: true });
}

function onOnline() {
  if (state.status === 'error') setState({ status: 'idle', error: null, progress: 0 });
}

function finishPlayStart(ok: boolean) {
  if (!playStart) return;
  clearTimeout(playStart.timer);
  playStart.resolve(ok);
  playStart = null;
}

function onMessage(e: MessageEvent) {
  if (!frame || e.source !== frame.contentWindow || e.origin !== window.location.origin) return;
  const data = e.data as { type?: string; event?: string; data?: unknown };
  if (data?.type !== 'vlibras_event') return;

  switch (data.event) {
    case 'update_progress': {
      const p = Number(data.data);
      if (Number.isNaN(p)) return;
      setState({ progress: p });
      // Download terminado: agora é só esperar a inicialização do Unity.
      // Sem encaixe ninguém está esperando, então não conta tempo.
      if (slot) armLoadTimer(p >= 1 ? INIT_MS : STALL_MS);
      return;
    }
    case 'on_load_player': {
      clearTimeout(loadTimer);
      loopPaused = false;
      send('setBaseUrl', bundlesUrl());
      send('setSubtitlesState', 0);
      send('setSlider', state.speed);
      setState({ status: 'ready', progress: 1, error: null });
      if (!slot) pauseLoop();
      if (pending) {
        const p = pending;
        pending = null;
        void play(p.glosses).then(p.resolve);
      }
      return;
    }
    case 'on_playing_state_change': {
      // [isPlaying, isPaused, isPlayingIntervalAnimation, isLoading, isRepeatable], como texto "True"/"False"
      const flags = (Array.isArray(data.data) ? data.data : []).map((v) => v === 'True' || v === true);
      const [isPlaying, isPaused, , isLoading] = flags;
      const playing = Boolean(isPlaying && !isPaused);
      if (playing && !isLoading) finishPlayStart(true);
      if (!isPlaying && !isLoading) finishPlayStart(true);
      if (playing !== state.playing) setState({ playing });
      return;
    }
    case 'on_error': {
      fail(data.data === 'unsupported' ? 'unsupported' : 'unavailable');
      return;
    }
    default:
  }
}

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  host.className = 'vlibras-host';
  host.setAttribute('aria-hidden', 'true');
  frame = document.createElement('iframe');
  frame.className = 'vlibras-frame';
  frame.title = 'VLibras';
  // O avatar só é assistido: os controles ficam no app, fora do iframe
  frame.tabIndex = -1;
  frame.setAttribute('allow', 'autoplay');
  host.appendChild(frame);
  document.body.appendChild(host);
  window.addEventListener('message', onMessage);
}

function dispose() {
  cancelAnimationFrame(rafId);
  rafId = 0;
  clearTimeout(idleTimer);
  window.removeEventListener('message', onMessage);
  host?.remove();
  host = null;
  frame = null;
  loopPaused = false;
  lastBox = '';
  finishPlayStart(false);
}

/** Carrega o player (uma vez). Chamado pelo primeiro exercício que precisa do avatar. */
export function ensureVlibrasLoaded() {
  if (state.status === 'loading' || state.status === 'ready') return;
  ensureHost();
  setState({ status: 'loading', progress: 0, error: null, playing: false });
  armLoadTimer(STALL_MS);
  frame!.src = BRIDGE_URL;
}

/** Descarta e carrega de novo (botão "Tentar de novo"). */
export function retryVlibras() {
  dispose();
  setState({ status: 'idle', progress: 0, error: null, playing: false });
  ensureVlibrasLoaded();
}

/** Confere se a animação existe e responde, antes de pedir ao Unity. */
async function bundleAvailable(gloss: string): Promise<boolean> {
  try {
    const res = await fetch(bundlesUrl() + encodeURIComponent(gloss), { method: 'GET', credentials: 'omit' });
    // O servidor de desenvolvimento responde o index.html (200) para arquivo que não existe
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Toca a glosa (ou a sequência separada por espaço). Resolve `true` quando começa a tocar e
 * `false` se a animação não puder ser obtida. Sem essa checagem o VLibras soletraria a
 * palavra letra por letra, o que entregaria a resposta no "Qual é este sinal?".
 */
export async function play(glosses: string): Promise<boolean> {
  if (state.status === 'error') return false;
  if (state.status !== 'ready') {
    pending?.resolve(false);
    return new Promise((resolve) => { pending = { glosses, resolve }; ensureVlibrasLoaded(); });
  }
  const parts = glosses.split(' ').filter(Boolean);
  const ok = (await Promise.all(parts.map(bundleAvailable))).every(Boolean);
  if (!ok || state.status !== 'ready') return false;
  resumeLoop();
  finishPlayStart(false);
  send('setSubtitlesState', 0);
  send('setSlider', state.speed);
  send('playNow', parts.join(' '));
  return new Promise((resolve) => {
    playStart = { resolve, timer: setTimeout(() => { playStart = null; resolve(false); }, PLAY_START_MS) };
  });
}

export function stopVlibras() {
  if (state.status === 'ready') send('stopAll');
}

export function setVlibrasSpeed(speed: VlibrasSpeed) {
  setState({ speed });
  if (state.status === 'ready') send('setSlider', speed);
}

function occludedBox(rect: DOMRect): { top: number; bottom: number } {
  let top = Math.max(rect.top, 0);
  let bottom = Math.min(rect.bottom, window.innerHeight);
  document.querySelectorAll<HTMLElement>(OCCLUDERS).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.right <= rect.left || r.left >= rect.right) return;
    // Barra em cima (topo da lição) corta de cima; painel no rodapé corta de baixo
    if (r.top <= top && r.bottom > top) top = Math.min(r.bottom, bottom);
    else if (r.top < bottom && r.bottom >= bottom) bottom = Math.max(r.top, top);
  });
  return { top, bottom };
}

function follow() {
  rafId = requestAnimationFrame(follow);
  if (!host || !slot) return;
  const rect = slot.getBoundingClientRect();
  const { top, bottom } = occludedBox(rect);
  const visible = state.status === 'ready' && bottom - top > 0;
  const clipTop = Math.max(0, top - rect.top);
  const clipBottom = Math.max(0, rect.bottom - bottom);
  const box = `${rect.left}|${rect.top}|${rect.width}|${rect.height}|${clipTop}|${clipBottom}|${visible}`;
  if (box === lastBox) return;
  lastBox = box;
  const s = host.style;
  s.transform = `translate(${rect.left}px, ${rect.top}px)`;
  s.width = `${rect.width}px`;
  s.height = `${rect.height}px`;
  s.clipPath = clipTop || clipBottom ? `inset(${clipTop}px 0 ${clipBottom}px 0 round var(--lx-radius-md))` : '';
  host.classList.toggle('vlibras-host--visible', visible);
}

/**
 * Coloca o avatar por cima de `el` até a função devolvida ser chamada. Só um encaixe por vez:
 * o mais recente vence.
 */
export function attachVlibras(el: HTMLElement): () => void {
  clearTimeout(idleTimer);
  slot = el;
  if (state.status === 'loading') armLoadTimer(state.progress >= 1 ? INIT_MS : STALL_MS);
  ensureVlibrasLoaded();
  lastBox = '';
  host?.classList.add('vlibras-host--attached');
  resumeLoop();
  if (!rafId) rafId = requestAnimationFrame(follow);
  return () => {
    if (slot !== el) return;
    slot = null;
    cancelAnimationFrame(rafId);
    rafId = 0;
    lastBox = '';
    // Invisível e com o laço pausado: GPU livre para a câmera. O iframe continua com o
    // mesmo tamanho (fora da tela o navegador poderia travar a inicialização do Unity).
    host?.classList.remove('vlibras-host--attached', 'vlibras-host--visible');
    if (state.status === 'loading') clearTimeout(loadTimer);
    pauseLoop();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (slot) return;
      dispose();
      setState({ status: 'idle', progress: 0, playing: false });
    }, IDLE_DISPOSE_MS);
  };
}

/** Só para testes. */
export function __resetVlibrasForTests() {
  dispose();
  clearTimeout(loadTimer);
  pending = null;
  slot = null;
  state = { status: 'idle', progress: 0, playing: false, speed: 1, error: null };
  listeners.clear();
}
