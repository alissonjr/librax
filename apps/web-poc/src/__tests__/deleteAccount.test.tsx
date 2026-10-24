import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Amplify fica de fora: sessão e saída da conta controladas pelo teste
const auth = vi.hoisted(() => ({
  getSession: vi.fn(async (): Promise<{ token: string; userId: string } | null> => ({ token: 'jwt.id', userId: 'sub-1' })),
  signOutAccount: vi.fn(async () => {}),
}));
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  getSession: auth.getSession,
  signOutAccount: auth.signOutAccount,
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
import { __resetAccountForTests, type AccountState } from '../lib/account';
import { __resetSyncForTests, clearOutbox, configureSync, enqueueLessonCompletion, pendingEntries } from '../lib/sync';
import type { IdbRepo } from '../lib/idbRepo';

// Excluir conta (spec-02 12.8 e LGPD): com conta, o servidor apaga primeiro (DELETE /v1/users/me);
// se a chamada falhar, nada sai do aparelho. Sem conta, segue só local.

type Call = { url: string; method: string; auth: string | null };

function mockFetch(respond: () => Promise<{ ok: boolean; status: number }>) {
  const calls: Call[] = [];
  configureSync({
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', auth: (init.headers as Record<string, string>).Authorization ?? null });
      return respond();
    }) as unknown as typeof fetch,
  });
  return calls;
}

function renderSettings(account: AccountState) {
  __resetAccountForTests(account);
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

async function confirmDelete() {
  await userEvent.click(screen.getByRole('button', { name: /Excluir conta e dados/ }));
  await userEvent.type(screen.getByPlaceholderText('EXCLUIR'), 'EXCLUIR');
  await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }));
}

const signedIn: AccountState = { status: 'signedIn', email: 'ana@librax.example' };

beforeEach(async () => {
  vi.clearAllMocks();
  __resetSyncForTests();
  configureSync({ getSession: auth.getSession });
  await clearOutbox();
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  // window.location.replace('/') no fim: o jsdom só reclama que não navega
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('excluir conta com conta conectada', () => {
  it('avisa que a conta e o progresso vão ser apagados para sempre, no aparelho e no servidor', async () => {
    renderSettings(signedIn);
    await userEvent.click(screen.getByRole('button', { name: /Excluir conta e dados/ }));
    expect(screen.getByText(/apaga para sempre a sua conta e todo o seu progresso/)).toBeInTheDocument();
    expect(screen.getByText(/neste aparelho e no servidor/)).toBeInTheDocument();
  });

  it('chama DELETE /v1/users/me com o token e só depois limpa o aparelho e sai da conta', async () => {
    const calls = mockFetch(async () => ({ ok: true, status: 200 }));
    const repo = renderSettings(signedIn);
    await enqueueLessonCompletion({ lessonId: 'u1-l1', today: '2026-10-23', score: 1 });

    await confirmDelete();

    await waitFor(() => expect(repo.clearAllData).toHaveBeenCalled());
    expect(calls).toEqual([{ url: '/api/v1/users/me', method: 'DELETE', auth: 'Bearer jwt.id' }]);
    expect(auth.signOutAccount).toHaveBeenCalled();
    expect(await pendingEntries()).toHaveLength(0);
    expect(localStorage.getItem('librax_displayName')).toBeNull();
  });

  it('erro do servidor: nada sai do aparelho e a mensagem pede para tentar de novo', async () => {
    const calls = mockFetch(async () => ({ ok: false, status: 500 }));
    const repo = renderSettings(signedIn);
    await enqueueLessonCompletion({ lessonId: 'u1-l1', today: '2026-10-23', score: 1 });

    await confirmDelete();

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível excluir sua conta agora: nada foi apagado.');
    expect(calls).toHaveLength(1);
    expect(repo.clearAllData).not.toHaveBeenCalled();
    expect(auth.signOutAccount).not.toHaveBeenCalled();
    expect(await pendingEntries()).toHaveLength(1);
    expect(localStorage.getItem('librax_displayName')).toBe('Ana');

    // tentar de novo funciona quando o servidor volta
    mockFetch(async () => ({ ok: true, status: 200 }));
    await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }));
    await waitFor(() => expect(repo.clearAllData).toHaveBeenCalled());
  });

  it('sem internet (offline ou falha de rede): nada sai do aparelho e a mensagem fala da conexão', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    const calls = mockFetch(async () => ({ ok: true, status: 200 }));
    const repo = renderSettings(signedIn);
    await confirmDelete();
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão: nada foi apagado.');
    expect(calls).toHaveLength(0);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    configureSync({ fetch: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão: nada foi apagado.'));
    expect(repo.clearAllData).not.toHaveBeenCalled();
    expect(localStorage.getItem('librax_displayName')).toBe('Ana');
  });

  it('sessão que não renova: não apaga nada', async () => {
    auth.getSession.mockResolvedValueOnce(null);
    const calls = mockFetch(async () => ({ ok: true, status: 200 }));
    const repo = renderSettings(signedIn);
    await confirmDelete();
    expect(await screen.findByRole('alert')).toHaveTextContent('nada foi apagado');
    expect(calls).toHaveLength(0);
    expect(repo.clearAllData).not.toHaveBeenCalled();
  });

  it('enquanto confere a sessão, o botão fica desligado', async () => {
    renderSettings({ status: 'checking', email: null });
    await userEvent.click(screen.getByRole('button', { name: /Excluir conta e dados/ }));
    await userEvent.type(screen.getByPlaceholderText('EXCLUIR'), 'EXCLUIR');
    expect(screen.getByRole('button', { name: 'Excluir conta' })).toBeDisabled();
  });
});

describe('excluir sem conta (convidado)', () => {
  it('segue só local: não chama o servidor e limpa o aparelho', async () => {
    const calls = mockFetch(async () => ({ ok: true, status: 200 }));
    const repo = renderSettings({ status: 'guest', email: null });
    await userEvent.click(screen.getByRole('button', { name: /Excluir conta e dados/ }));
    expect(screen.getByText(/apaga para sempre todo o progresso guardado neste aparelho/)).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('EXCLUIR'), 'EXCLUIR');
    await userEvent.click(screen.getByRole('button', { name: 'Excluir conta' }));

    await waitFor(() => expect(repo.clearAllData).toHaveBeenCalled());
    expect(calls).toHaveLength(0);
    expect(auth.signOutAccount).not.toHaveBeenCalled();
    expect(localStorage.getItem('librax_displayName')).toBeNull();
  });
});
