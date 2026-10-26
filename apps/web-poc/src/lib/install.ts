/**
 * Instalação do PWA ("adicionar à tela inicial"), decisão 13 do plano mobile web e spec-02 12.1.
 *
 * Duas formas de oferecer, nunca obrigatórias e nunca com o app já instalado:
 * - Faixa discreta no topo do mapa (InstallBanner), desde a primeira visita, quando o app está numa
 *   aba do navegador (shouldShowInstallBanner).
 * - Convite completo (InstallSheet) ao voltar ao mapa depois da primeira lição concluída, para todos,
 *   com ou sem conta; dispensado, volta uma vez só, dias depois e com mais uma lição (shouldSuggestInstall).
 *
 * Como instalar em cada lugar (getInstallMode):
 * - Chrome e Edge (Android e computador), Samsung Internet: o navegador dispara `beforeinstallprompt`;
 *   guardamos o evento e mostramos o pedido nativo só quando a pessoa toca em "Instalar".
 * - Safari do iPhone e do iPad: não há evento; mostramos as instruções de "Compartilhar > Adicionar à
 *   Tela de Início".
 * - Onde não dá para instalar (navegadores dentro de outros apps no iOS, Chrome e Firefox do iPhone,
 *   Firefox no computador, navegador sem o evento): nada aparece.
 * Nas Configurações a opção continua disponível enquanto houver como instalar.
 * Dentro do app Android da loja (TWA, lib/twa.ts) o app já está instalado: nada aparece.
 */

import { Flags } from './flags';
import { isTwa, rememberTwaLaunch } from './twa';

const DAY = 24 * 60 * 60 * 1000;

/** Faixa do topo: depois de fechada, some por estes dias. */
export const BANNER_SNOOZE_DAYS = 7;
/** Faixa do topo: depois de fechada esta quantidade de vezes, não volta mais. */
export const BANNER_MAX_DISMISSALS = 3;
/** Convite completo: vezes que aparece no total (a primeira e uma repetição). */
export const INVITE_MAX_OFFERS = 2;
/** Convite completo: dias de espera antes de repetir. */
export const INVITE_RETRY_DAYS = 3;
/** Convite completo: lições concluídas a mais, desde o último convite, antes de repetir. */
export const INVITE_RETRY_LESSONS = 1;

/** Quantas vezes o convite completo já apareceu, quando foi o último e com quantas lições. */
export interface InviteState {
  count: number;
  /** Momento do último convite (ms). */
  at: number;
  /** Lições concluídas no momento do último convite. */
  lessons: number;
}

/** Quantas vezes a faixa do topo foi fechada e quando foi a última. */
export interface BannerState {
  count: number;
  /** Momento do último fechamento (ms). */
  at: number;
}

/**
 * Quando mostrar o convite completo (decisão 13 do plano, spec-02 12.1):
 * - depois da primeira lição concluída, com ou sem conta (conclusões repetidas também contam);
 * - dispensado, aparece mais uma vez só, passados INVITE_RETRY_DAYS dias e com pelo menos
 *   INVITE_RETRY_LESSONS lição concluída depois do convite anterior; depois disso, nunca mais.
 */
export function shouldSuggestInstall(opts: {
  invite: InviteState;
  lessonsCompleted: number;
  now: number;
}): boolean {
  const { invite, lessonsCompleted, now } = opts;
  if (lessonsCompleted < 1 || invite.count >= INVITE_MAX_OFFERS) return false;
  if (invite.count === 0) return true;
  return now - invite.at >= INVITE_RETRY_DAYS * DAY
    && lessonsCompleted >= invite.lessons + INVITE_RETRY_LESSONS;
}

/**
 * Quando mostrar a faixa do topo do mapa:
 * - só com um jeito de instalar neste navegador (mode diferente de null) e o app ainda numa aba;
 * - fechada, some por BANNER_SNOOZE_DAYS dias e, depois de BANNER_MAX_DISMISSALS fechamentos, de vez;
 * - o convite completo dispensado também a faz sumir pelos mesmos dias, para não insistir em seguida.
 */
export function shouldShowInstallBanner(opts: {
  mode: InstallMode;
  banner: BannerState;
  invite: InviteState;
  now: number;
}): boolean {
  const { mode, banner, invite, now } = opts;
  if (mode === null || banner.count >= BANNER_MAX_DISMISSALS) return false;
  const lastNo = Math.max(banner.count > 0 ? banner.at : -Infinity, invite.count > 0 ? invite.at : -Infinity);
  return now - lastNo >= BANNER_SNOOZE_DAYS * DAY;
}

/* ---------- o que fica guardado no aparelho ---------- */

const temporaryState = new Map<string, string>();

function readJson<T>(key: string): Partial<T> | null {
  let raw: string | null;
  try {
    raw = temporaryState.get(key) ?? Flags.get(key);
  } catch {
    raw = temporaryState.get(key) ?? null;
  }
  try {
    const value = raw ? JSON.parse(raw) as unknown : null;
    return value && typeof value === 'object' ? value as Partial<T> : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  try {
    Flags.set(key, raw);
    temporaryState.delete(key);
  } catch {
    // Sem armazenamento, os limites continuam valendo nesta visita, inclusive ao trocar de tela.
    temporaryState.set(key, raw);
  }
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);

export function loadInviteState(): InviteState {
  const saved = readJson<InviteState>('installInvite');
  if (saved) return { count: num(saved.count), at: num(saved.at), lessons: num(saved.lessons) };
  // Regra anterior: o convite aparecia uma vez só e ficava marcado em "installSuggested"
  try {
    if (Flags.installSuggested()) return { count: 1, at: 0, lessons: 0 };
  } catch {
    /* sem armazenamento */
  }
  return { count: 0, at: 0, lessons: 0 };
}

/** Grava que o convite completo apareceu agora (chamado ao fechar o InstallSheet). */
export function recordInviteShown(lessonsCompleted: number, now = Date.now()): InviteState {
  const next = { count: loadInviteState().count + 1, at: now, lessons: lessonsCompleted };
  writeJson('installInvite', next);
  return next;
}

export function loadBannerState(): BannerState {
  const saved = readJson<BannerState>('installBanner');
  return { count: num(saved?.count), at: num(saved?.at) };
}

/** Grava que a faixa do topo foi fechada agora (ou que o pedido aberto por ela foi recusado). */
export function recordBannerDismissed(now = Date.now()): BannerState {
  const next = { count: loadBannerState().count + 1, at: now };
  writeJson('installBanner', next);
  return next;
}

/* ---------- plataforma ---------- */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios' | null;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Liga a escuta dos eventos. Chamado uma vez no main.tsx, antes de o React montar. */
export function initInstall(): void {
  if (typeof window === 'undefined') return;
  // Aberto pelo app Android (?origem=android ou referrer android-app://): lê antes do roteador
  rememberTwaLaunch();
  window.addEventListener('beforeinstallprompt', (e) => {
    // Segura o mini-infobar do Chrome: o app decide o momento de sugerir
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    // Fica guardado: a aba do navegador que instalou nunca mais sugere
    try { Flags.set('appInstalled'); } catch { /* sem armazenamento */ }
    notify();
  });
}

/** Aberto como app (tela inicial ou janela própria), e não numa aba do navegador. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']
    .some(mode => window.matchMedia?.(`(display-mode: ${mode})`).matches === true);
}

/** iPhone ou iPad (o iPad com iPadOS se apresenta como Mac, mas tem toque). */
export function isIos(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
}

/**
 * Navegadores do iOS que não instalam pelas instruções do Safari: os de dentro de outros apps
 * (Instagram, Facebook, WhatsApp, TikTok, Google...) e os que não são o Safari (Chrome, Firefox,
 * Edge, Opera). O Safari tem "Safari/" e "Version/" no user agent; os apps de dentro não têm.
 */
const IOS_NOT_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|FBAN|FBAV|FB_IAB|Instagram|WhatsApp|Line\/|Twitter|LinkedInApp|Snapchat|TikTok|musical_ly|BytedanceWebview|Pinterest|GSA\//;

/** Safari do iPhone ou do iPad, onde "Adicionar à Tela de Início" existe. */
export function isIosSafari(ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean {
  return isIos(ua, touchPoints) && /Version\/[\d.]+.*Safari\//.test(ua) && !IOS_NOT_SAFARI.test(ua);
}

/** O app já foi instalado a partir deste navegador (evento appinstalled, guardado). */
function wasInstalled(): boolean {
  if (installed) return true;
  try { return Flags.has('appInstalled'); } catch { return false; }
}

/** Como dá para instalar agora: pedido nativo, instruções do iOS, ou nada. */
export function getInstallMode(): InstallMode {
  if (typeof window === 'undefined' || wasInstalled() || isStandalone() || isTwa()) return null;
  if (deferred) return 'prompt';
  if (isIosSafari()) return 'ios';
  return null;
}

/**
 * Abre o pedido nativo de instalação (Chrome, Edge, Samsung Internet).
 * Retorna 'accepted', 'dismissed' ou null quando não há pedido guardado.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | null> {
  const event = deferred;
  if (!event) return null;
  // O evento só pode ser usado uma vez
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Só para testes: volta ao estado inicial (sem pedido guardado, não instalado). */
export function resetInstallForTests(): void {
  deferred = null;
  installed = false;
  temporaryState.clear();
  notify();
}
