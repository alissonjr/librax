import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import {
  BANNER_MAX_DISMISSALS, BANNER_SNOOZE_DAYS, INVITE_RETRY_DAYS, getInstallMode, initInstall, isIosSafari,
  isStandalone, loadBannerState, loadInviteState, promptInstall, recordBannerDismissed, recordInviteShown,
  resetInstallForTests, shouldShowInstallBanner, shouldSuggestInstall, type InviteState,
} from '../lib/install';
import { UA, firePromptEvent, setDevice, setDisplayMode } from './installTestUtils';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);
const NO_INVITE: InviteState = { count: 0, at: 0, lessons: 0 };


describe('convite completo (InstallSheet): regra de tempo', () => {
  it('aparece depois da primeira lição concluída, com ou sem conta', () => {
    expect(shouldSuggestInstall({ invite: NO_INVITE, lessonsCompleted: 0, now: NOW })).toBe(false);
    expect(shouldSuggestInstall({ invite: NO_INVITE, lessonsCompleted: 1, now: NOW })).toBe(true);
  });

  it(`dispensado, volta só depois de ${INVITE_RETRY_DAYS} dias e com mais uma lição`, () => {
    const invite = { count: 1, at: NOW, lessons: 1 };
    // Mesmo dia, mesmo com mais lições: não
    expect(shouldSuggestInstall({ invite, lessonsCompleted: 5, now: NOW + DAY })).toBe(false);
    // Passaram os dias, mas sem lição nova: não
    expect(shouldSuggestInstall({ invite, lessonsCompleted: 1, now: NOW + INVITE_RETRY_DAYS * DAY })).toBe(false);
    // Dias e lição nova: sim
    expect(shouldSuggestInstall({ invite, lessonsCompleted: 2, now: NOW + INVITE_RETRY_DAYS * DAY })).toBe(true);
  });

  it('depois da segunda vez, nunca mais', () => {
    const invite = { count: 2, at: NOW, lessons: 2 };
    expect(shouldSuggestInstall({ invite, lessonsCompleted: 50, now: NOW + 365 * DAY })).toBe(false);
  });
});

describe('faixa do topo (InstallBanner): regra de tempo', () => {
  const fresh = { count: 0, at: 0 };

  it('aparece desde a primeira visita, quando dá para instalar', () => {
    expect(shouldShowInstallBanner({ mode: 'prompt', banner: fresh, invite: NO_INVITE, now: NOW })).toBe(true);
    expect(shouldShowInstallBanner({ mode: 'ios', banner: fresh, invite: NO_INVITE, now: NOW })).toBe(true);
  });

  it('não aparece onde não dá para instalar', () => {
    expect(shouldShowInstallBanner({ mode: null, banner: fresh, invite: NO_INVITE, now: NOW })).toBe(false);
  });

  it(`fechada, some por ${BANNER_SNOOZE_DAYS} dias`, () => {
    const banner = { count: 1, at: NOW };
    expect(shouldShowInstallBanner({ mode: 'prompt', banner, invite: NO_INVITE, now: NOW + DAY })).toBe(false);
    expect(shouldShowInstallBanner({ mode: 'prompt', banner, invite: NO_INVITE, now: NOW + (BANNER_SNOOZE_DAYS - 1) * DAY })).toBe(false);
    expect(shouldShowInstallBanner({ mode: 'prompt', banner, invite: NO_INVITE, now: NOW + BANNER_SNOOZE_DAYS * DAY })).toBe(true);
  });

  it(`fechada ${BANNER_MAX_DISMISSALS} vezes, não volta mais`, () => {
    const banner = { count: BANNER_MAX_DISMISSALS, at: NOW };
    expect(shouldShowInstallBanner({ mode: 'prompt', banner, invite: NO_INVITE, now: NOW + 365 * DAY })).toBe(false);
  });

  it('o convite completo dispensado também a faz esperar', () => {
    const invite = { count: 1, at: NOW, lessons: 1 };
    expect(shouldShowInstallBanner({ mode: 'ios', banner: fresh, invite, now: NOW + 2 * DAY })).toBe(false);
    expect(shouldShowInstallBanner({ mode: 'ios', banner: fresh, invite, now: NOW + BANNER_SNOOZE_DAYS * DAY })).toBe(true);
  });
});

describe('o que fica guardado no aparelho', () => {
  beforeEach(() => {
    localStorage.clear();
    resetInstallForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it('conta os fechamentos da faixa e guarda o último', () => {
    expect(loadBannerState()).toEqual({ count: 0, at: 0 });
    recordBannerDismissed(NOW);
    recordBannerDismissed(NOW + DAY);
    expect(loadBannerState()).toEqual({ count: 2, at: NOW + DAY });
  });

  it('conta os convites com o momento e as lições', () => {
    expect(loadInviteState()).toEqual(NO_INVITE);
    recordInviteShown(1, NOW);
    expect(loadInviteState()).toEqual({ count: 1, at: NOW, lessons: 1 });
    recordInviteShown(3, NOW + 4 * DAY);
    expect(loadInviteState()).toEqual({ count: 2, at: NOW + 4 * DAY, lessons: 3 });
  });

  it('a flag da regra antiga conta como um convite já visto', () => {
    localStorage.setItem('librax_installSuggested', '1');
    expect(loadInviteState().count).toBe(1);
  });

  it('valor estragado no armazenamento vira estado vazio', () => {
    localStorage.setItem('librax_installBanner', '{quebrado');
    expect(loadBannerState()).toEqual({ count: 0, at: 0 });
  });

  it('campos inválidos não burlam os limites', () => {
    localStorage.setItem('librax_installInvite', JSON.stringify({ count: -2, at: 'ontem', lessons: null }));
    expect(loadInviteState()).toEqual(NO_INVITE);
  });

  it.each(['setItem', 'getItem'] as const)('sem %s, mantém os limites nesta visita', (method) => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    if (method === 'getItem') {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('bloqueado'); });
    }
    recordBannerDismissed(NOW);
    recordBannerDismissed(NOW + DAY);
    expect(loadBannerState()).toEqual({ count: 2, at: NOW + DAY });
    recordInviteShown(1, NOW);
    recordInviteShown(2, NOW + 4 * DAY);
    expect(loadInviteState()).toEqual({ count: 2, at: NOW + 4 * DAY, lessons: 2 });
  });

  it('se gravar falhar depois de uma visita anterior, soma ao estado já salvo', () => {
    recordBannerDismissed(NOW);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('cheio'); });
    recordBannerDismissed(NOW + DAY);
    recordBannerDismissed(NOW + 2 * DAY);
    expect(loadBannerState()).toEqual({ count: 3, at: NOW + 2 * DAY });
  });
});

describe('plataforma: como dá para instalar', () => {
  beforeAll(() => initInstall());
  beforeEach(() => {
    localStorage.clear();
    resetInstallForTests();
    setDisplayMode(null);
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
  });
  afterEach(() => setDevice(UA.firefoxDesktop));

  it('reconhece o Safari do iPhone e do iPad', () => {
    expect(isIosSafari(UA.iphoneSafari, 5)).toBe(true);
    expect(isIosSafari(UA.ipadDesktop, 5)).toBe(true);
  });

  it('não confunde Mac sem toque, outros navegadores do iPhone e apps com navegador dentro', () => {
    expect(isIosSafari(UA.ipadDesktop, 0)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneInstagram, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneFacebook, 5)).toBe(false);
    expect(isIosSafari(UA.androidChrome, 5)).toBe(false);
  });

  it('Safari do iPhone: instruções', () => {
    setDevice(UA.iphoneSafari, 5);
    expect(getInstallMode()).toBe('ios');
  });

  it('Instagram no iPhone e Firefox no computador: nada', () => {
    setDevice(UA.iphoneInstagram, 5);
    expect(getInstallMode()).toBeNull();
    setDevice(UA.firefoxDesktop);
    expect(getInstallMode()).toBeNull();
  });

  it('Chrome: pedido nativo quando o beforeinstallprompt chega, e só uma vez', async () => {
    setDevice(UA.androidChrome, 5);
    expect(getInstallMode()).toBeNull();
    const event = firePromptEvent('dismissed');
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallMode()).toBe('prompt');
    await expect(promptInstall()).resolves.toBe('dismissed');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(getInstallMode()).toBeNull();
    await expect(promptInstall()).resolves.toBeNull();
  });

  it.each(['standalone', 'minimal-ui', 'window-controls-overlay'])('aberto como app (display-mode %s): nada', (mode) => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    setDisplayMode(mode);
    expect(isStandalone()).toBe(true);
    expect(getInstallMode()).toBeNull();
  });

  it('aberto pela tela de início do iPhone (navigator.standalone): nada', () => {
    setDevice(UA.iphoneSafari, 5);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    expect(isStandalone()).toBe(true);
    expect(getInstallMode()).toBeNull();
  });

  it('depois do appinstalled: nada, e continua assim na próxima visita', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallMode()).toBeNull();
    // Nova visita na mesma aba: o estado em memória zera, mas o aparelho lembra
    resetInstallForTests();
    firePromptEvent();
    expect(getInstallMode()).toBeNull();
  });
});
