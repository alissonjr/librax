import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstallBanner } from '../components/InstallBanner';
import { getInstallMode, initInstall, resetInstallForTests } from '../lib/install';
import { isTwa, isTwaReferrer, rememberTwaLaunch, resetTwaForTests } from '../lib/twa';
import { UA, firePromptEvent, setDevice, setDisplayMode } from './installTestUtils';

/** Janela de mentira com o endereço e o referrer da abertura. */
function fakeWindow(href: string, referrer = '') {
  const replaceState = vi.fn();
  const win = {
    location: { href },
    history: { state: null, replaceState },
    document: { referrer },
    sessionStorage: window.sessionStorage,
  } as unknown as Window;
  return { win, replaceState };
}

describe('app Android da loja (TWA): detecção', () => {
  beforeEach(() => resetTwaForTests());

  it('reconhece a abertura com ?origem=android e tira o parâmetro da barra, mantendo o resto', () => {
    const { win, replaceState } = fakeWindow('https://app.librax.example/licao/u1-l1?origem=android&lang=es#topo');
    expect(rememberTwaLaunch(win)).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/licao/u1-l1?lang=es#topo');
    expect(isTwa()).toBe(true);
  });

  it('reconhece o referrer android-app:// do próprio pacote, sem mexer na URL', () => {
    const { win, replaceState } = fakeWindow('https://app.librax.example/', 'android-app://br.com.librax.app/');
    expect(rememberTwaLaunch(win)).toBe(true);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('link aberto de outro app Android (Gmail, WhatsApp) não conta', () => {
    expect(isTwaReferrer('android-app://com.google.android.gm/')).toBe(false);
    expect(isTwaReferrer('android-app://com.whatsapp')).toBe(false);
    expect(isTwaReferrer('https://www.google.com/')).toBe(false);
    expect(isTwaReferrer('android-app://br.com.librax.app')).toBe(true);
    const { win } = fakeWindow('https://app.librax.example/', 'android-app://com.whatsapp/');
    expect(rememberTwaLaunch(win)).toBe(false);
    expect(isTwa()).toBe(false);
  });

  it('outro valor de origem não conta e fica na URL', () => {
    const { win, replaceState } = fakeWindow('https://app.librax.example/?origem=landing');
    expect(rememberTwaLaunch(win)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('a marca vale para a aba inteira: recarregar ou navegar sem o parâmetro continua TWA', () => {
    rememberTwaLaunch(fakeWindow('https://app.librax.example/?origem=android').win);
    // Página recarregada: a memória do módulo some, o sessionStorage da aba fica
    resetTwaCacheOnly();
    expect(rememberTwaLaunch(fakeWindow('https://app.librax.example/perfil').win)).toBe(true);
  });

  it('nada vai para o localStorage (o Chrome comum do aparelho divide o mesmo)', () => {
    localStorage.clear();
    rememberTwaLaunch(fakeWindow('https://app.librax.example/?origem=android').win);
    expect(localStorage.length).toBe(0);
  });

  it('sem sessionStorage, vale enquanto a página estiver aberta', () => {
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('bloqueado'); });
    expect(rememberTwaLaunch(fakeWindow('https://app.librax.example/?origem=android').win)).toBe(true);
    expect(isTwa()).toBe(true);
    blocked.mockRestore();
  });
});

/** Simula a página recarregada: esquece o que o módulo lembrava, sem apagar a aba. */
function resetTwaCacheOnly() {
  const saved = sessionStorage.getItem('librax_twa');
  resetTwaForTests();
  if (saved !== null) sessionStorage.setItem('librax_twa', saved);
}

describe('app Android da loja (TWA): sem convites de instalar', () => {
  beforeAll(() => initInstall());
  beforeEach(() => {
    localStorage.clear();
    resetInstallForTests();
    resetTwaForTests();
    setDisplayMode(null);
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
  });
  afterEach(() => {
    resetTwaForTests();
    setDevice(UA.firefoxDesktop);
  });

  it('mesmo com o pedido nativo disponível (Chrome sem suporte a TWA abre numa Custom Tab), não há como instalar', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    expect(getInstallMode()).toBe('prompt');
    rememberTwaLaunch(fakeWindow('https://app.librax.example/?origem=android').win);
    expect(getInstallMode()).toBeNull();
  });

  it('a faixa "Instalar o app" do mapa não aparece', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    rememberTwaLaunch(fakeWindow('https://app.librax.example/', 'android-app://br.com.librax.app/').win);
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <InstallBanner />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Instalar o app' })).not.toBeInTheDocument();
  });

  it('no Chrome comum do mesmo aparelho a faixa continua', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <InstallBanner />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Instalar o app' })).toBeInTheDocument();
  });
});
