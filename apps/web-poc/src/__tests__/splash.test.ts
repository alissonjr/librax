import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SPLASH_MIN_VISIBLE_MS, SPLASH_SAFETY_MS, SPLASH_SHOW_DELAY_MS, SPLASH_STEPS,
  __resetSplashForTests, finishSplash, holdSplash, setSplashLabel, splashHidePlan, splashPercent,
  splashShellReady, splashStep, whenSplashDone, type SplashStep,
} from '../lib/splash';

/** O mesmo esqueleto do index.html (só o que o splash.ts mexe). */
function mountSplash() {
  document.body.innerHTML = `
    <div id="lx-splash" class="lx-splash">
      <div class="lx-splash-brand" role="img" aria-label="Librax, versão beta">librax Beta</div>
      <div class="lx-splash-bar" role="progressbar" aria-label="Abrindo o Librax" aria-valuenow="20">
        <div class="lx-splash-fill" style="width: 20%"></div>
      </div>
    </div>`;
}

const bar = () => document.querySelector('[role="progressbar"]');
const fill = () => document.querySelector<HTMLElement>('.lx-splash-fill');
const splash = () => document.getElementById('lx-splash');

describe('splashPercent', () => {
  it('cada etapa vale o mesmo pedaço, em qualquer ordem', () => {
    expect(SPLASH_STEPS).toHaveLength(5);
    expect(splashPercent(new Set<SplashStep>(['painted']))).toBe(20);
    expect(splashPercent(new Set<SplashStep>(['painted', 'screen']))).toBe(40);
    expect(splashPercent(new Set<SplashStep>(['painted', 'app', 'storage']))).toBe(60);
    expect(splashPercent(new Set(SPLASH_STEPS))).toBe(100);
  });
});

describe('splashHidePlan', () => {
  it('pronto antes de a marca aparecer: sai na hora, sem transição', () => {
    expect(splashHidePlan(SPLASH_SHOW_DELAY_MS - 1, false)).toEqual({ waitMs: 0, fade: false });
  });

  it('já apareceu: fica o tempo mínimo na tela e sai com fade', () => {
    const plan = splashHidePlan(SPLASH_SHOW_DELAY_MS + 100, false);
    expect(plan.fade).toBe(true);
    expect(plan.waitMs).toBe(SPLASH_MIN_VISIBLE_MS - 100);
  });

  it('na tela há tempo: espera só a barra chegar ao fim (nada com reduzir movimento)', () => {
    const late = SPLASH_SHOW_DELAY_MS + SPLASH_MIN_VISIBLE_MS + 5000;
    expect(splashHidePlan(late, false).waitMs).toBeGreaterThan(0);
    expect(splashHidePlan(late, true)).toEqual({ waitMs: 0, fade: true });
  });
});

describe('etapas da abertura', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSplashForTests();
    mountSplash();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('cada etapa avança a barra e o aria-valuenow; a mesma etapa não conta duas vezes', () => {
    splashStep('app');
    expect(bar()?.getAttribute('aria-valuenow')).toBe('40');
    expect(fill()?.style.width).toBe('40%');
    splashStep('app');
    expect(bar()?.getAttribute('aria-valuenow')).toBe('40');
    splashStep('storage');
    splashStep('screen');
    expect(bar()?.getAttribute('aria-valuenow')).toBe('80');
  });

  it('o rótulo da barra troca para o idioma do app', () => {
    setSplashLabel('Opening Librax', 'Beta version');
    expect(bar()?.getAttribute('aria-label')).toBe('Opening Librax');
    expect(document.querySelector('.lx-splash-brand')?.getAttribute('aria-label')).toBe('Librax, Beta version');
  });

  it('espera os skeletons saírem depois que a primeira rota montou', async () => {
    const releaseFallback = holdSplash();
    splashShellReady();
    vi.advanceTimersByTime(10);
    expect(splash()).not.toBeNull();

    // O Suspense troca o fallback pelo skeleton da própria tela no mesmo commit
    releaseFallback();
    const releaseData = holdSplash();
    vi.advanceTimersByTime(10);
    expect(splash()).not.toBeNull();
    expect(bar()?.getAttribute('aria-valuenow')).not.toBe('100');

    releaseData();
    vi.advanceTimersByTime(10);
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100');
    await expect(whenSplashDone()).resolves.toBeUndefined();
  });

  it('sem skeleton, só a rota montada não basta antes do roteador', () => {
    const release = holdSplash();
    release();
    vi.advanceTimersByTime(10);
    // O roteador ainda não montou (App.tsx no boot): continua
    expect(bar()?.getAttribute('aria-valuenow')).toBe('20');
    splashShellReady();
    vi.advanceTimersByTime(10);
    expect(bar()?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('liberar duas vezes o mesmo skeleton não desconta outro', () => {
    splashShellReady();
    const a = holdSplash();
    holdSplash();
    a();
    a();
    vi.advanceTimersByTime(10);
    expect(bar()?.getAttribute('aria-valuenow')).toBe('20');
  });

  it('pronto antes de a marca aparecer: a abertura sai do DOM na hora', () => {
    vi.spyOn(performance, 'now').mockReturnValue(SPLASH_SHOW_DELAY_MS - 50);
    finishSplash();
    expect(splash()).toBeNull();
  });

  it('já visível: sai com fade depois do tempo mínimo', () => {
    vi.spyOn(performance, 'now').mockReturnValue(SPLASH_SHOW_DELAY_MS + 50);
    finishSplash();
    expect(splash()?.classList.contains('lx-splash--out')).toBe(false);
    vi.advanceTimersByTime(SPLASH_MIN_VISIBLE_MS);
    expect(splash()?.classList.contains('lx-splash--out')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(splash()).toBeNull();
  });

  it('se algo travar, sai sozinha depois do tempo de segurança', () => {
    splashStep('app');
    holdSplash();
    vi.advanceTimersByTime(SPLASH_SAFETY_MS + 2000);
    expect(splash()).toBeNull();
  });
});
