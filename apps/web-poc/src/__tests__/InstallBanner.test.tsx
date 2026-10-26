import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { ReactElement } from 'react';
import { act, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { InstallBanner } from '../components/InstallBanner';
import { I18nProvider } from '../i18n';
import {
  BANNER_SNOOZE_DAYS, initInstall, loadBannerState, recordInviteShown, resetInstallForTests,
} from '../lib/install';
import { UA, firePromptEvent, setDevice, setDisplayMode } from './installTestUtils';

const DAY = 24 * 60 * 60 * 1000;

// O InstallSheet (instruções do iPhone) usa o histórico do roteador (useCloseOnBack)
const render = (ui: ReactElement) => rtlRender(ui, {
  wrapper: ({ children }) => (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
  ),
});

describe('InstallBanner (faixa do topo do mapa)', () => {
  beforeAll(() => initInstall());
  beforeEach(() => {
    localStorage.clear();
    resetInstallForTests();
    setDisplayMode(null);
    Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    setDevice(UA.firefoxDesktop);
  });

  it('Android: "Instalar o app" abre o pedido nativo', async () => {
    setDevice(UA.androidChrome, 5);
    const event = firePromptEvent('accepted');
    render(<InstallBanner />);
    expect(screen.getByRole('region', { name: 'Use o Librax como app' })).toBeInTheDocument();
    expect(screen.getByText('Abre com um toque, em tela cheia.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Instalar o app' }));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    // Aceito não conta como recusa
    expect(loadBannerState().count).toBe(0);
  });

  it('Android: recusar o pedido nativo conta como fechar a faixa', async () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent('dismissed');
    render(<InstallBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Instalar o app' }));
    expect(loadBannerState().count).toBe(1);
  });

  it.each([
    ['en', 'Use Librax as an app', 'How to install', 'Got it', 'Put Librax on your home screen'],
    ['es', 'Usa Librax como app', 'Cómo instalar', 'Entendido', 'Pon Librax en tu pantalla de inicio'],
  ])('faixa e instruções traduzidas em %s', async (lang, title, action, close, sheetTitle) => {
    setDevice(UA.iphoneSafari, 5);
    localStorage.setItem('librax_lang', lang);
    render(<I18nProvider><InstallBanner /></I18nProvider>);
    expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: action }));
    expect(screen.getByRole('dialog', { name: sheetTitle })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: close }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('iPhone (Safari): "Como instalar" abre as instruções e "Entendi" fecha tudo', async () => {
    setDevice(UA.iphoneSafari, 5);
    render(<InstallBanner />);
    expect(screen.getByText('Pelo Safari, em dois toques.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Como instalar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog').parentElement).toBe(document.body);
    expect(screen.getByText('Toque em Compartilhar, na barra do Safari.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(loadBannerState().count).toBe(1);
  });

  it(`fechar (X) esconde e só volta depois de ${BANNER_SNOOZE_DAYS} dias`, async () => {
    setDevice(UA.iphoneSafari, 5);
    const { unmount } = render(<InstallBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar sugestão de instalar' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();

    // Voltou ao mapa no dia seguinte: nada
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + DAY);
    const second = render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    second.unmount();

    // Passaram os dias: volta
    vi.setSystemTime(Date.now() + BANNER_SNOOZE_DAYS * DAY);
    render(<InstallBanner />);
    expect(screen.getByRole('region', { name: 'Use o Librax como app' })).toBeInTheDocument();
  });

  it('não aparece junto com o convite completo, nem logo depois de ele ser dispensado', () => {
    setDevice(UA.iphoneSafari, 5);
    const { unmount } = render(<InstallBanner suppressed />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();
    recordInviteShown(1);
    render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('não aparece onde não dá para instalar (Instagram no iPhone, Firefox no computador)', () => {
    setDevice(UA.iphoneInstagram, 5);
    const { unmount } = render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();
    setDevice(UA.firefoxDesktop);
    render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('não aparece com o app instalado (standalone)', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    setDisplayMode('standalone');
    render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('some quando o app é instalado com a faixa na tela', () => {
    setDevice(UA.androidChrome, 5);
    firePromptEvent();
    render(<InstallBanner />);
    expect(screen.getByRole('region')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('some quando o app é instalado com as instruções abertas', async () => {
    setDevice(UA.iphoneSafari, 5);
    render(<InstallBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Como instalar' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => { window.dispatchEvent(new Event('appinstalled')); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('uma falha no pedido nativo fecha a faixa sem contar como recusa', async () => {
    setDevice(UA.androidChrome, 5);
    const event = firePromptEvent();
    vi.mocked(event.prompt).mockRejectedValueOnce(new Error('sem pedido'));
    render(<InstallBanner />);
    await userEvent.click(screen.getByRole('button', { name: 'Instalar o app' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(loadBannerState().count).toBe(0);
  });

  it('o pedido nativo que chega depois de o mapa abrir fica para a próxima vez (sem empurrar a tela)', () => {
    setDevice(UA.androidChrome, 5);
    const { unmount } = render(<InstallBanner />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    act(() => { firePromptEvent(); });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();
    render(<InstallBanner />);
    expect(screen.getByRole('region')).toBeInTheDocument();
  });
});
