/*
 * Comportamento da landing, por cima do HTML pronto (que funciona sem JS):
 * - a abertura soletra LIBRAX com as seis mãos desenhadas e depois troca de pessoa em cada letra;
 *   com 3D no navegador, a mão em 3D (mao3d.ts, com o motor 3D e o modelo) ocupa o palco no
 *   lugar delas (start3d);
 * - as instruções de instalação viram abas e abrem na plataforma de quem visita;
 * - o seletor de idioma guarda a escolha e a faixa sugere o idioma do navegador quando ele é
 *   outro. O app fica em outro endereço: o idioma vai para ele no link (?lang=, config.ts).
 */
import handUrl from '../../web-poc/src/mao3d/mao-3d.glb?url';
import maos from './maos.json';
import { bonesPath, easeStandard, lerpPose, HERO_LETTERS, type Pose } from './hands';
import { detectPlatform, type Platform } from './install';
import { APP_LANG_KEY, LANDING_LANG_KEY, isLocale, localeFromPath, suggestLocale, switchHref } from './locale';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const store = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* sem armazenamento: segue sem lembrar */ }
  },
};

// ---------- abertura: LIBRAX soletrado ----------

type State = 'idle' | 'tracking' | 'ready' | 'correct';
interface Tile {
  el: HTMLElement;
  paths: SVGPathElement[];
  joints: SVGCircleElement[];
  poses: Pose[];
  index: number;
  current: number[];
}

function setPose(tile: Tile, pose: readonly number[]) {
  tile.current = [...pose];
  const d = bonesPath(pose);
  tile.paths.forEach((p) => p.setAttribute('d', d));
  tile.joints.forEach((c, i) => {
    c.setAttribute('cx', String(Math.round(pose[i * 2] * 1000) / 1000));
    c.setAttribute('cy', String(Math.round(pose[i * 2 + 1] * 1000) / 1000));
  });
}

function setState(tile: Tile, state: State) {
  tile.el.dataset.state = state;
}

function animatePose(tile: Tile, to: Pose, ms: number): Promise<void> {
  const from = tile.current;
  const start = performance.now();
  return new Promise((done) => {
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setPose(tile, lerpPose(from, to, easeStandard(t)));
      if (t < 1) requestAnimationFrame(step);
      else done();
    };
    requestAnimationFrame(step);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initStage() {
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  if (!stage) return;
  const word = stage.querySelector<HTMLElement>('[data-stage-word]');
  const status = stage.querySelector<HTMLElement>('[data-stage-status]');
  const toggle = stage.querySelector<HTMLButtonElement>('[data-stage-toggle]');
  const letras = maos.letras as Record<string, { poses: number[][] }>;

  const tiles: Tile[] = HERO_LETTERS.map((L) => {
    const el = stage.querySelector<HTMLElement>(`.tile[data-letter="${L}"]`)!;
    return {
      el,
      paths: [...el.querySelectorAll<SVGPathElement>('.hand-halo, .hand-bones')],
      joints: [...el.querySelectorAll<SVGCircleElement>('.hand-joint')],
      poses: letras[L].poses,
      index: 0,
      current: [...letras[L].poses[0]],
    };
  });

  // Menos movimento: fica o estado final, já desenhado (seção 9.3 do design system)
  if (reduceMotion.matches) return;

  let paused = false;
  let visible = true;
  let running = false;
  const reading = status?.dataset.reading ?? '';
  const done = status?.dataset.done ?? '';

  // As seis mãos desenhadas só andam quando ficam no palco (sem 3D ou se ele falhou, start3d)
  const canRun = () => !paused && visible && !document.hidden && stage.dataset.view === '2d';
  const until = async () => {
    while (!canRun()) await wait(250);
  };

  async function spell() {
    stage!.dataset.phase = 'reading';
    tiles.forEach((t) => setState(t, 'idle'));
    if (word) word.textContent = `${reading}...`;
    await wait(500);
    let spelled = '';
    for (const t of tiles) {
      await until();
      setState(t, 'tracking');
      await wait(260);
      setState(t, 'ready');
      await wait(220);
      setState(t, 'correct');
      spelled += t.el.dataset.letter;
      if (word) word.textContent = `${reading}: ${spelled}`;
      await wait(160);
    }
    stage!.dataset.phase = 'done';
    if (word) word.textContent = `${done}: ${spelled}`;
  }

  async function loop() {
    if (running) return;
    running = true;
    await until();
    await spell();
    let k = 0;
    for (;;) {
      await wait(1500);
      await until();
      const t = tiles[k % tiles.length];
      k += 1;
      t.index = (t.index + 1) % t.poses.length;
      setState(t, 'tracking');
      await animatePose(t, t.poses[t.index], 520);
      setState(t, 'ready');
      await wait(180);
      setState(t, 'correct');
    }
  }

  if (toggle) {
    toggle.hidden = false;
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      paused = !paused;
      toggle.setAttribute('aria-pressed', String(paused));
      toggle.setAttribute('aria-label', (paused ? toggle.dataset.play : toggle.dataset.pause) ?? '');
    });
  }

  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) void loop();
  }, { threshold: 0.15 }).observe(stage);
}

// ---------- abertura em 3D ----------

function canDraw3d(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

/**
 * Se a mão em 3D não aparecer nesse tempo (rede muito lenta, erro), o palco fica com as mãos
 * desenhadas. Num 3G rápido ela aparece em uns 3,5 s depois da página.
 */
const FALLBACK_MS = 8000;

/**
 * Abertura: com JS, o palco começa só com a moldura vazia (classe lx-js, posta no <head> antes de
 * desenhar), e a mão em 3D aparece por cima quando fica pronta. As seis mãos desenhadas só entram
 * sem 3D no navegador, se o 3D falhar ou demorar demais (e sem JS, direto no HTML).
 * O código 3D e o modelo são pedidos juntos e já no começo, sem esperar o resto da página.
 */
function start3d() {
  const stage = document.querySelector<HTMLElement>('[data-stage]');
  if (!stage) return;
  const show2d = () => {
    if (stage.dataset.view !== '3d') stage.dataset.view = '2d';
  };
  if (!canDraw3d()) {
    show2d();
    return;
  }
  const timer = window.setTimeout(show2d, FALLBACK_MS);
  const model = fetch(handUrl).then((r) => {
    if (!r.ok) throw new Error(`modelo da mão: ${r.status}`);
    return r.arrayBuffer();
  });
  model.catch(() => { /* o erro chega pelo startHand3d */ });
  // ?letra=A&pessoa=3: uma pose parada, para comparar com o desenho 2D da mesma pessoa
  const params = new URLSearchParams(location.search);
  const letter = params.get('letra')?.toUpperCase();
  const still = letter ? { letter, person: Number(params.get('pessoa') ?? 0) || 0 } : undefined;
  const claim = () => {
    if (stage.dataset.view === '2d') return false;
    window.clearTimeout(timer);
    return true;
  };
  import('./mao3d')
    .then((m) => m.startHand3d(stage, { model, reduced: reduceMotion.matches, claim, still }))
    .catch((e) => {
      // Sem a mão em 3D, a abertura fica com as mãos desenhadas
      console.warn('abertura em 3D indisponível', e);
      show2d();
    });
}

// ---------- instalar: abas por plataforma ----------

function initInstall() {
  const root = document.querySelector<HTMLElement>('[data-install]');
  const tablist = root?.querySelector<HTMLElement>('[data-tabs]');
  if (!root || !tablist) return;
  const tabs = [...tablist.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const detected = detectPlatform({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    uaPlatform: nav.userAgentData?.platform,
  });

  const select = (p: Platform, focus = false) => {
    tabs.forEach((t) => {
      const on = t.dataset.tab === p;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.platform !== p; });
  };

  tabs.forEach((t, i) => {
    if (t.dataset.tab === detected) t.querySelector<HTMLElement>('[data-detected]')?.removeAttribute('hidden');
    t.addEventListener('click', () => select(t.dataset.tab as Platform));
    t.addEventListener('keydown', (e) => {
      const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
      if (e.key in keys) {
        e.preventDefault();
        const next = tabs[(i + keys[e.key] + tabs.length) % tabs.length];
        select(next.dataset.tab as Platform, true);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        select((e.key === 'Home' ? tabs[0] : tabs[tabs.length - 1]).dataset.tab as Platform, true);
      }
    });
  });
  tablist.hidden = false;
  root.dataset.ready = '';
  select(detected);
}

// ---------- idioma ----------

function initLanguage() {
  const current = localeFromPath(location.pathname);
  document.querySelectorAll<HTMLAnchorElement>('a[data-lang]').forEach((a) => {
    a.addEventListener('click', () => {
      const target = a.dataset.lang;
      if (!isLocale(target)) return;
      store.set(LANDING_LANG_KEY, target);
      store.set(APP_LANG_KEY, target);
      a.href = switchHref(target, location.hash);
    });
  });

  // Fecha o menu de idioma com Esc ou clique fora
  const menu = document.querySelector<HTMLDetailsElement>('[data-lang-menu]');
  if (menu) {
    document.addEventListener('click', (e) => { if (menu.open && !menu.contains(e.target as Node)) menu.open = false; });
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary')?.focus(); }
    });
  }

  const suggestion = suggestLocale(current, navigator.languages ?? [navigator.language], store.get(LANDING_LANG_KEY));
  const bar = document.querySelector<HTMLElement>('[data-lang-suggest]');
  if (!suggestion || !bar) return;
  let texts: Record<string, { suggest: string; action: string }> = {};
  try { texts = JSON.parse(bar.dataset.texts ?? '{}'); } catch { return; }
  const copy = texts[suggestion];
  if (!copy) return;
  const text = bar.querySelector<HTMLElement>('[data-lang-suggest-text]')!;
  const link = bar.querySelector<HTMLAnchorElement>('[data-lang-suggest-link]')!;
  const close = bar.querySelector<HTMLButtonElement>('[data-lang-suggest-close]')!;
  text.textContent = copy.suggest;
  text.lang = suggestion;
  link.textContent = copy.action;
  link.lang = suggestion;
  link.hreflang = suggestion;
  link.href = switchHref(suggestion, location.hash);
  link.dataset.lang = suggestion;
  link.addEventListener('click', () => {
    store.set(LANDING_LANG_KEY, suggestion);
    store.set(APP_LANG_KEY, suggestion);
  });
  close.setAttribute('aria-label', bar.dataset.dismiss ?? '');
  close.addEventListener('click', () => {
    store.set(LANDING_LANG_KEY, current);
    bar.hidden = true;
  });
  bar.hidden = false;
}

start3d();
initStage();
initInstall();
initLanguage();
