import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdminApp } from '../App';
import { ApiError, type AdminApi } from '../lib/api';
import type { AdminAuth } from '../lib/auth';
import { mockApi } from '../dev/mock';

// Portão do painel: sem sessão mostra a tela de entrar; com sessão, só abre se a API
// (GET /v1/admin/me) confirmar o grupo admin. 403 mostra "Sem acesso" e nenhuma tela de dados.

function session(over: Partial<AdminAuth> = {}): AdminAuth {
  return {
    hasSession: () => true,
    signIn: vi.fn(async () => ({ kind: 'done' as const })),
    confirmTotp: vi.fn(async () => ({ kind: 'done' as const })),
    completeNewPassword: vi.fn(async () => ({ kind: 'done' as const })),
    signOut: vi.fn(async () => {}),
    clear: vi.fn(),
    ...over,
  };
}

function renderApp(api: AdminApi, s: AdminAuth, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AdminApp api={api} session={s} />
    </MemoryRouter>,
  );
}

const forbidden = (): AdminApi => {
  const err = () => Promise.reject(new ApiError(403, 'ADMIN_ONLY', 'Acesso restrito ao grupo admin'));
  return { me: err, overview: err, content: err, searchAccounts: err, account: err, squads: err, cost: err, usage: err, feedback: err };
};

describe('acesso', () => {
  it('sem sessão: tela de entrar própria, sem chamar a API e sem link de cadastro', async () => {
    const api = { ...mockApi(), me: vi.fn() } as unknown as AdminApi;
    renderApp(api, session({ hasSession: () => false }));
    expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
    expect(screen.queryByText(/criar conta|cadastr/i)).not.toBeInTheDocument();
    expect(api.me).not.toHaveBeenCalled();
  });

  it('entrar com senha e código do autenticador abre o painel', async () => {
    let signedIn = false;
    const s = session({
      hasSession: () => signedIn,
      signIn: vi.fn(async () => ({ kind: 'totp' as const, session: 's', username: 'u' })),
      confirmTotp: vi.fn(async () => {
        signedIn = true;
        return { kind: 'done' as const };
      }),
    });
    renderApp(mockApi(), s);
    await userEvent.type(screen.getByLabelText('E-mail'), 'dono@exemplo.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await userEvent.type(await screen.findByLabelText('Código de 6 dígitos'), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(await screen.findByRole('heading', { name: 'Operação' })).toBeInTheDocument();
    expect(s.signIn).toHaveBeenCalledWith('dono@exemplo.com', 'senha-123');
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
    expect(s.signOut).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
  });

  it('token recusado (401): limpa e pede login de novo', async () => {
    const api = { ...mockApi(), me: () => Promise.reject(new ApiError(401, 'UNAUTHORIZED', 'expirou')) };
    const s = session();
    renderApp(api, s);
    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(s.clear).toHaveBeenCalled();
  });

  it('sair pela barra: revoga a sessão e volta para a tela de entrar', async () => {
    const s = session();
    renderApp(mockApi(), s, '/contas');
    await screen.findByRole('navigation', { name: 'Seções do painel' });
    await userEvent.click(screen.getByRole('button', { name: /Sair/ }));
    expect(s.signOut).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('endereço antigo da volta do login hospedado cai no painel, sem nada na URL', async () => {
    renderApp(mockApi(), session({ hasSession: () => false }), '/auth/callback?code=abc&state=x');
    expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
  });

  it('admin: barra com as sete seções e selo de só leitura', async () => {
    renderApp(mockApi(), session());
    const nav = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(nav).getAllByRole('link').map((a) => a.textContent?.trim())).toEqual(['Operação', 'Uso', 'Câmera', 'Conteúdo', 'Contas', 'Squads', 'Custo']);
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
