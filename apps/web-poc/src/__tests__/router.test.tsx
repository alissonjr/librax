import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';

// O avatar VLibras não roda no jsdom: a demonstração cai na descrição em texto
const vlibrasState = vi.hoisted(() => ({ status: 'error', progress: 0, playing: false, speed: 1, error: 'sem avatar' }));
vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => vlibrasState,
  subscribeVlibras: () => () => {},
  attachVlibras: () => () => {},
  play: async () => false,
  retryVlibras: () => {},
  stopVlibras: () => {},
  setVlibrasSpeed: () => {},
}));

import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';

async function renderAt(entries: string[], seed?: (repo: IdbRepo) => Promise<void>, brokenStreak = 0) {
  const db = await openDB(`librax-router-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  const repo = new IdbRepo(db, 'user-test');
  await repo.saveProfile({ userId: 'user-test', xpTotal: 0, streak: 0, achievements: [] });
  await seed?.(repo);
  const router = createMemoryRouter(routes, {
    initialEntries: entries,
    initialIndex: entries.length - 1,
    future: ROUTER_FUTURE,
  });
  render(
    <SessionProvider repo={repo} userId="user-test" brokenStreak={brokenStreak}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>,
  );
  return router;
}

const path = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname;

beforeEach(() => {
  // jsdom não rola a página
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
});

describe('roteador', () => {
  it('sem onboarding, qualquer rota leva as boas-vindas', async () => {
    localStorage.clear();
    const router = await renderAt(['/perfil']);
    await waitFor(() => expect(path(router)).toBe('/boas-vindas'));
  });

  it('a raiz abre a aba Aprender', async () => {
    const router = await renderAt(['/']);
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('as abas mudam a URL e o voltar de outra aba leva a Aprender', async () => {
    const router = await renderAt(['/aprender']);
    const tabs = () => within(screen.getByRole('navigation'));
    await screen.findByRole('navigation');
    await userEvent.click(tabs().getByRole('button', { name: /praticar/i }));
    await waitFor(() => expect(path(router)).toBe('/praticar'));
    expect(tabs().getByRole('button', { name: /praticar/i })).toHaveAttribute('aria-current', 'page');
    // Entre abas que nao sao Aprender a entrada e trocada, nao empilhada
    await userEvent.click(tabs().getByRole('button', { name: /perfil/i }));
    await waitFor(() => expect(path(router)).toBe('/perfil'));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('Social abre a liga em /social/liga e o voltar retorna a Social', async () => {
    const router = await renderAt(['/aprender', '/social']);
    await act(() => router.navigate('/social/liga'));
    await waitFor(() => expect(path(router)).toBe('/social/liga'));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(path(router)).toBe('/social'));
  });

  it('rota desconhecida e licao inexistente voltam para o inicio', async () => {
    const router = await renderAt(['/nao-existe']);
    await waitFor(() => expect(path(router)).toBe('/aprender'));
    await act(() => router.navigate('/licao/u99-l1'));
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('conclusao sem resultado (pagina recarregada) volta ao mapa', async () => {
    const router = await renderAt(['/licao/u1-l1/concluida']);
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('abrir /licao/:id direto carrega a licao do bundle', async () => {
    await renderAt(['/licao/u1-l1']);
    const bar = await screen.findByRole('progressbar');
    expect(Number(bar.getAttribute('aria-valuemax'))).toBeGreaterThan(10);
  });

  it('licao bloqueada no mapa nao abre pelo endereco: volta ao mapa com aviso', async () => {
    const router = await renderAt(['/aprender', '/licao/u1-l3']);
    await waitFor(() => expect(path(router)).toBe('/aprender'));
    expect(await screen.findByRole('status')).toHaveTextContent('Essa lição ainda está bloqueada');
  });

  it('licao concluida e a proxima disponivel abrem pelo endereco', async () => {
    const router = await renderAt(['/licao/u1-l2'], async (repo) => {
      await repo.saveProgress('user-test', 'u1-l1', { status: 'completed', bestScore: 1 });
    });
    await screen.findByRole('progressbar');
    expect(path(router)).toBe('/licao/u1-l2');
  });

  it('licao concluida continua aberta para refazer', async () => {
    const router = await renderAt(['/licao/u1-l1'], async (repo) => {
      await repo.saveProgress('user-test', 'u1-l1', { status: 'completed', bestScore: 1 });
      await repo.saveProgress('user-test', 'u1-l2', { status: 'completed', bestScore: 1 });
    });
    await screen.findByRole('progressbar');
    expect(path(router)).toBe('/licao/u1-l1');
  });

  it('com um sheet aberto, o voltar fecha o sheet e fica na tela', async () => {
    const router = await renderAt(['/aprender'], undefined, 5);
    expect(await screen.findByRole('dialog')).toHaveTextContent('5');
    // Abrir o sheet criou uma entrada no historico com o mesmo endereco
    await waitFor(() => expect(router.state.historyAction).toBe('PUSH'));
    expect(path(router)).toBe('/aprender');

    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(path(router)).toBe('/aprender');
    expect(router.state.historyAction).toBe('POP');
  });

  it('o voltar dentro da licao abre "Sair da licao?" em vez de sair direto', async () => {
    const router = await renderAt(['/aprender', '/licao/u1-l1']);
    await screen.findByRole('progressbar');

    // Voltar do navegador / Android
    await act(() => router.navigate(-1));
    expect(await screen.findByText('Sair da lição?')).toBeInTheDocument();
    expect(path(router)).toBe('/licao/u1-l1');

    // Continuar fica na licao
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(screen.queryByText('Sair da lição?')).not.toBeInTheDocument());
    expect(path(router)).toBe('/licao/u1-l1');

    // Botao do topo: mesmo dialogo; Sair volta ao mapa
    await userEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('com "Sair da licao?" aberto, um novo voltar fecha o dialogo e fica na licao', async () => {
    const router = await renderAt(['/aprender', '/licao/u1-l1']);
    await screen.findByRole('progressbar');
    await act(() => router.navigate(-1));
    expect(await screen.findByText('Sair da lição?')).toBeInTheDocument();
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByText('Sair da lição?')).not.toBeInTheDocument());
    expect(path(router)).toBe('/licao/u1-l1');
  });
});
