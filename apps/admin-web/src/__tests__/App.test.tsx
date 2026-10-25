import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminApp, type Session } from '../App';
import { ApiError, type AdminApi } from '../lib/api';
import { mockApi } from '../dev/mock';

// Portão do painel: sem token pede login; com token, só abre se a API (GET /v1/admin/me) confirmar o
// grupo admin. 403 mostra "Sem acesso" e nenhuma tela de dados.

function session(over: Partial<Session> = {}): Session {
  return { hasToken: () => true, login: vi.fn(), logout: vi.fn(), completeLogin: vi.fn(async () => {}), clear: vi.fn(), ...over };
}

function renderApp(api: AdminApi, s: Session, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminApp api={api} session={s} />
    </MemoryRouter>,
  );
}

const forbidden = (): AdminApi => {
  const err = () => Promise.reject(new ApiError(403, 'ADMIN_ONLY', 'Acesso restrito ao grupo admin'));
  return { me: err, overview: err, content: err, searchAccounts: err, account: err, squads: err, cost: err };
};

describe('acesso', () => {
  it('sem token: tela de entrar, sem chamar a API', async () => {
    const api = { ...mockApi(), me: vi.fn() } as unknown as AdminApi;
    const s = session({ hasToken: () => false });
    renderApp(api, s);
    await userEvent.click(screen.getByRole('button', { name: /Entrar/ }));
    expect(s.login).toHaveBeenCalled();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('conta fora do grupo admin: "Sem acesso" e nenhum dado', async () => {
    const api = forbidden();
    const overview = vi.spyOn(api, 'overview');
    const s = session();
    renderApp(api, s);
    expect(await screen.findByText('Esta conta não é de administração')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(overview).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(s.logout).toHaveBeenCalled();
  });

  it('token expirado (401): limpa e pede login de novo', async () => {
    const api = { ...mockApi(), me: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'expirou')) };
    const s = session();
    renderApp(api, s);
    expect(await screen.findByRole('button', { name: /Entrar/ })).toBeInTheDocument();
    expect(s.clear).toHaveBeenCalled();
  });

  it('volta do login: completa e abre a operação', async () => {
    const s = session();
    renderApp(mockApi(), s, '/auth/callback?code=abc&state=x');
    expect(await screen.findByRole('heading', { name: 'Operação' })).toBeInTheDocument();
    expect(s.completeLogin).toHaveBeenCalledWith('?code=abc&state=x');
  });

  it('admin: barra com as seis seções e selo de só leitura', async () => {
    renderApp(mockApi(), session());
    const nav = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Operação', 'Câmera', 'Conteúdo', 'Contas', 'Squads', 'Custo']);
    expect(screen.getByText('só leitura')).toBeInTheDocument();
    expect(screen.getByText('dono@exemplo.com')).toBeInTheDocument();
  });

  it('troca de tema: sistema, claro, escuro', async () => {
    renderApp(mockApi(), session());
    const button = await screen.findByRole('button', { name: /Tema do sistema/ });
    await userEvent.click(button);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: /Tema claro/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await userEvent.click(screen.getByRole('button', { name: /Tema escuro/ }));
    await waitFor(() => expect(document.documentElement.hasAttribute('data-theme')).toBe(false));
  });
});
