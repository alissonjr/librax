import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Amplify fica de fora: sessão controlada pelo teste
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  getSession: vi.fn(async () => null),
  signOutAccount: vi.fn(async () => {}),
}));
// O avatar VLibras não roda no jsdom
vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => ({ status: 'error', progress: 0, playing: false, speed: 1, error: 'sem avatar' }),
  subscribeVlibras: () => () => {},
  attachVlibras: () => () => {},
  play: async () => false,
  retryVlibras: () => {},
  stopVlibras: () => {},
  setVlibrasSpeed: () => {},
}));

import { SettingsScreen } from '../screens/SettingsScreen';
import { UsageNotice } from '../components/UsageNotice';
import { __resetAccountForTests } from '../lib/account';
import { KEYS, __resetTelemetryForTests, configureTelemetry, getTelemetryId, isTelemetryEnabled, pendingEvents, track } from '../lib/telemetry';
import { PRIVACY_POLICY_VERSION, usageNoticePending } from '../lib/usageNotice';
import { I18nProvider } from '../i18n';
import type { IdbRepo } from '../lib/idbRepo';

// Interruptor "Enviar dados de uso anônimos" (Configurações), exclusão dos dados e o aviso de uma
// vez para quem já usava o app.

let fetchMock: ReturnType<typeof vi.fn>;

function renderSettings() {
  __resetAccountForTests({ status: 'guest', email: null });
  const repo = {
    clearAllData: vi.fn(async () => {}),
    getProfile: vi.fn(async () => null),
    listSrsItems: vi.fn(async () => []),
  };
  render(
    <MemoryRouter>
      <SettingsScreen userId="usr-1" repo={repo as unknown as IdbRepo} onBack={() => {}} />
    </MemoryRouter>,
  );
  return repo;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
  __resetTelemetryForTests();
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  configureTelemetry({ fetch: fetchMock as unknown as typeof fetch, sendBeacon: null, online: () => true, onboarded: () => true, apiBase: '/api' });
  // window.location.replace('/') no fim da exclusão: o jsdom só reclama que não navega
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('interruptor nas Configurações', () => {
  it('ligado por padrão, com o estado e o motivo escritos', () => {
    renderSettings();
    const toggle = screen.getByRole('switch', { name: /Enviar dados de uso anônimos/ });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(toggle).toHaveTextContent('Ligado. Métricas de uso para calibrar o algoritmo e os exercícios, sem identificar você.');
  });

  it('desligar para de guardar, esquece o código e pede ao servidor para apagar a cópia', async () => {
    track({ type: 'app_open' });
    const id = getTelemetryId();
    renderSettings();
    await userEvent.click(screen.getByRole('switch', { name: /Enviar dados de uso anônimos/ }));
    expect(screen.getByRole('switch', { name: /Enviar dados de uso anônimos/ })).toHaveAttribute('aria-checked', 'false');
    expect(isTelemetryEnabled()).toBe(false);
    expect(pendingEvents()).toEqual([]);
    expect(localStorage.getItem(KEYS.id)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/v1/telemetry/${id}`, expect.objectContaining({ method: 'DELETE' })));

    // ligar de novo: código novo
    await userEvent.click(screen.getByRole('switch', { name: /Enviar dados de uso anônimos/ }));
    expect(isTelemetryEnabled()).toBe(true);
    expect(getTelemetryId()).not.toBe(id);
  });

  it('"Excluir conta e dados" (convidado) também apaga a cópia dos dados de uso e esquece o código', async () => {
    const id = getTelemetryId();
    const repo = renderSettings();
    await userEvent.click(screen.getByRole('button', { name: /Excluir conta e dados/ }));
    await userEvent.type(screen.getByPlaceholderText('EXCLUIR'), 'EXCLUIR');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }));
    await waitFor(() => expect(repo.clearAllData).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`/api/v1/telemetry/${id}`, expect.objectContaining({ method: 'DELETE', keepalive: true }));
    expect(localStorage.getItem(KEYS.id)).toBeNull();
    expect(localStorage.getItem('librax_displayName')).toBeNull();
  });
});

describe('aviso de uma vez para quem já usava o app', () => {
  it('aparece para quem já tinha feito as boas-vindas e some de vez ao fechar', async () => {
    expect(usageNoticePending()).toBe(true);
    render(<MemoryRouter><UsageNotice /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Dados de uso anônimos' })).toBeInTheDocument();
    expect(screen.getByText(/métricas de uso para calibrar o algoritmo e os exercícios, sem identificar você/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver a Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
    expect(screen.getByRole('link', { name: 'Configurações' })).toHaveAttribute('href', '/configuracoes');
    await userEvent.click(screen.getByRole('button', { name: 'Fechar aviso' }));
    expect(screen.queryByRole('heading', { name: 'Dados de uso anônimos' })).not.toBeInTheDocument();
    expect(localStorage.getItem('librax_policySeen')).toBe(PRIVACY_POLICY_VERSION);
    expect(usageNoticePending()).toBe(false);
  });

  it('quem já viu a versão dos dados de uso (1.4) não vê de novo nas versões seguintes', () => {
    localStorage.setItem('librax_policySeen', '1.4');
    expect(usageNoticePending()).toBe(false);
    localStorage.setItem('librax_policySeen', '1.10');
    expect(usageNoticePending()).toBe(false);
    localStorage.setItem('librax_policySeen', '1.3');
    expect(usageNoticePending()).toBe(true);
    localStorage.setItem('librax_policySeen', 'lixo');
    expect(usageNoticePending()).toBe(true);
  });

  it('quem ainda não fez as boas-vindas não vê (aceita a política nelas)', () => {
    localStorage.removeItem('librax_displayName');
    render(<MemoryRouter><UsageNotice /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: 'Dados de uso anônimos' })).not.toBeInTheDocument();
  });

  it('em inglês e espanhol, a mesma ideia', () => {
    localStorage.setItem('librax_lang', 'en');
    render(<I18nProvider><MemoryRouter><UsageNotice /></MemoryRouter></I18nProvider>);
    expect(screen.getByText(/usage metrics to calibrate the algorithm and the exercises, without identifying you/)).toBeInTheDocument();
    cleanup();
    localStorage.setItem('librax_lang', 'es');
    render(<I18nProvider><MemoryRouter><UsageNotice /></MemoryRouter></I18nProvider>);
    expect(screen.getByText(/métricas de uso para calibrar el algoritmo y los ejercicios, sin identificarte/)).toBeInTheDocument();
  });
});
