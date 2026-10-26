import { tokens } from '../styles/tokens';

/**
 * Tela de abertura (index.html, #lx-splash): pinta antes de o JS chegar e mostra o progresso real
 * da abertura, por etapas. Cada etapa vale o mesmo pedaço da barra e a ordem de chegada não importa
 * (o código da tela inicial começa a baixar junto com o banco local):
 *   1. painted: a página pintou (já sai assim no HTML);
 *   2. app: o código principal chegou e está rodando (main.tsx), com a estrutura do curso, que vem
 *      no mesmo pedaço (lib/course.ts);
 *   3. storage: banco local aberto, perfil lido ou criado e AppOpenFlow avaliado (boot do App.tsx);
 *   4. screen: o código da tela da rota chegou (pedaço sob demanda do router.tsx);
 *   5. content: a tela está com o conteúdo, sem skeleton (no mapa, o progresso salvo das lições lido).
 * Quando a última termina, a abertura sai com uma transição curta.
 */

export type SplashStep = 'painted' | 'app' | 'storage' | 'screen' | 'content';
export const SPLASH_STEPS: readonly SplashStep[] = ['painted', 'app', 'storage', 'screen', 'content'];

/** Porcentagem da barra: etapas cumpridas sobre o total. */
export function splashPercent(done: ReadonlySet<SplashStep>): number {
  return Math.round((done.size / SPLASH_STEPS.length) * 100);
}

const ms = (value: string) => Number.parseFloat(value);
/** A marca e a barra só aparecem depois disso (o mesmo atraso do CSS no index.html). */
export const SPLASH_SHOW_DELAY_MS = ms(tokens['motion.duration.base']);
/** Depois de aparecer, a abertura fica pelo menos isso na tela: surgir e sumir num instante pisca. */
export const SPLASH_MIN_VISIBLE_MS = 400;
/** A barra começa a andar até o fim antes de a tela sumir (o fade cobre o resto da transição). */
const FILL_MS = ms(tokens['motion.duration.fast']);
/** Se algo travar, a abertura sai mesmo assim e a pessoa vê o que o app mostra (erro, skeleton). */
export const SPLASH_SAFETY_MS = 15_000;

/**
 * Quando tirar a abertura, contando desde o início da navegação. Ficou pronto antes de a marca
 * aparecer: sai na hora e sem transição (o fundo é o mesmo do app, então nada pisca). Já apareceu:
 * espera a barra chegar ao fim e o tempo mínimo na tela, e sai com fade.
 */
export function splashHidePlan(elapsedMs: number, reducedMotion: boolean): { waitMs: number; fade: boolean } {
  if (elapsedMs < SPLASH_SHOW_DELAY_MS) return { waitMs: 0, fade: false };
  const minLeft = SPLASH_SHOW_DELAY_MS + SPLASH_MIN_VISIBLE_MS - elapsedMs;
  return { waitMs: Math.max(0, minLeft, reducedMotion ? 0 : FILL_MS), fade: true };
}

const done = new Set<SplashStep>(['painted']);
let shellReady = false;
let holds = 0;
let finished = false;
let checkTimer: ReturnType<typeof setTimeout> | undefined;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
let resolveDone: () => void = () => {};
let donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });

const splashEl = () => (typeof document === 'undefined' ? null : document.getElementById('lx-splash'));

function reducedMotion(): boolean {
  if (document.documentElement.getAttribute('data-reduced-motion') === 'true') return true;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function render() {
  const el = splashEl();
  if (!el) return;
  const pct = splashPercent(done);
  el.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(pct));
  const fill = el.querySelector<HTMLElement>('.lx-splash-fill');
  if (fill) fill.style.width = `${pct}%`;
}

/** Marca uma etapa como cumprida (a mesma etapa de novo não conta). */
export function splashStep(step: SplashStep): void {
  if (finished || done.has(step)) return;
  done.add(step);
  render();
  if (step === 'app') safetyTimer = setTimeout(finishSplash, SPLASH_SAFETY_MS);
}

/** Texto da barra para o leitor de tela no idioma do app (o HTML sai em pt-BR). */
export function setSplashLabel(label: string, betaLabel?: string): void {
  splashEl()?.querySelector('[role="progressbar"]')?.setAttribute('aria-label', label);
  if (betaLabel) splashEl()?.querySelector('.lx-splash-brand')?.setAttribute('aria-label', `Librax, ${betaLabel}`);
}

function scheduleCheck() {
  if (finished) return;
  clearTimeout(checkTimer);
  // Depois do commit do React: trocar o fallback do Suspense pelo skeleton da própria tela tira um
  // e põe outro no mesmo instante, e a contagem passa por zero no meio
  checkTimer = setTimeout(() => {
    if (shellReady && holds === 0) finishSplash();
  }, 0);
}

/** O roteador montou a primeira rota (RootLayout). Daqui em diante, nenhum skeleton = pronto. */
export function splashShellReady(): void {
  shellReady = true;
  scheduleCheck();
}

/**
 * Algo na tela ainda carrega (ScreenSkeleton): a abertura espera. Devolve a função que libera,
 * chamada quando o skeleton sai.
 */
export function holdSplash(): () => void {
  if (finished) return () => {};
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    scheduleCheck();
  };
}

/** Todas as etapas cumpridas: a barra vai ao fim e a abertura sai. */
export function finishSplash(): void {
  if (finished) return;
  finished = true;
  clearTimeout(checkTimer);
  clearTimeout(safetyTimer);
  SPLASH_STEPS.forEach((s) => done.add(s));
  render();
  resolveDone();

  const el = splashEl();
  if (!el) return;
  const plan = splashHidePlan(performance.now(), reducedMotion());
  if (!plan.fade) {
    el.remove();
    return;
  }
  setTimeout(() => {
    el.addEventListener('transitionend', (e) => { if (e.target === el) el.remove(); });
    el.classList.add('lx-splash--out');
    // Aba em segundo plano não dispara transitionend: sai do mesmo jeito
    setTimeout(() => el.remove(), 1000);
  }, plan.waitMs);
}

/** Resolve quando a abertura terminou (o app está na tela). */
export function whenSplashDone(): Promise<void> {
  return donePromise;
}

/** Só para testes. */
export function __resetSplashForTests(): void {
  clearTimeout(checkTimer);
  clearTimeout(safetyTimer);
  done.clear();
  done.add('painted');
  shellReady = false;
  holds = 0;
  finished = false;
  donePromise = new Promise<void>((resolve) => { resolveDone = resolve; });
}
