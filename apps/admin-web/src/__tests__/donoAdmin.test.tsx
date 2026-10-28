import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiContext } from '../lib/context';
import { mockApi } from '../dev/mock';
import { ContasScreen } from '../screens/ContasScreen';
import type { AdminApi } from '../lib/api';

// Quem é admin: o filtro "Só admins" e, só para o dono do painel, tornar admin e tirar do admin.

const withApi = (api: AdminApi, ui: ReactNode) =>
  render(<MemoryRouter><ApiContext.Provider value={api}>{ui}</ApiContext.Provider></MemoryRouter>);

async function abrir(api: AdminApi, email: RegExp) {
  withApi(api, <ContasScreen />);
  const lista = await screen.findByRole('list', { name: 'Contas' });
  await userEvent.click(within(lista).getByRole('button', { name: email }));
  return screen.findByRole('heading', { name: 'Ações na conta' });
}

const comum = (): AdminApi => ({ ...mockApi(), me: () => Promise.resolve({ userId: 'x', email: 'outra@exemplo.com', groups: ['admin'] }) });

describe('quem é admin', () => {
  it('"Só admins" lista quem tem acesso, com o dono marcado', async () => {
    const api = mockApi();
    const list = vi.spyOn(api, 'listAccounts');
    withApi(api, <ContasScreen />);
    await screen.findByRole('list', { name: 'Contas' });
    await userEvent.click(screen.getByRole('radio', { name: 'Só admins' }));
    const admins = await screen.findByRole('list', { name: 'Contas admin' });
    expect(list).toHaveBeenLastCalledWith(null, { group: 'admin' });
    const itens = within(admins).getAllByRole('button');
    expect(itens).toHaveLength(2);
    expect(itens[0]).toHaveTextContent('dono@exemplo.com');
    expect(itens[0]).toHaveTextContent('dono');
    expect(itens[1]).toHaveTextContent('carla2@exemplo.com');
    expect(itens[1]).toHaveTextContent('admin');
  });

  it('o dono torna admin só com o e-mail da conta digitado', async () => {
    const api = mockApi();
    const grant = vi.spyOn(api, 'grantAdmin');
    await abrir(api, /davi3@exemplo.com/);
    expect(screen.getByText('Painel').parentElement).toHaveTextContent('sem acesso');
    await userEvent.click(screen.getByRole('button', { name: /Tornar admin/ }));
    expect(screen.getByText(/configura o aplicativo autenticador/)).toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: 'Tornar admin' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Digite o e-mail da conta para confirmar'), 'davi3@exemplo.com');
    await userEvent.click(confirmar);
    await waitFor(() => expect(grant).toHaveBeenCalledWith(expect.any(String), 'davi3@exemplo.com'));
    await waitFor(() => expect(screen.getByText('Painel').parentElement).toHaveTextContent('admin'));
    expect(await screen.findByRole('button', { name: /Tirar do admin/ })).toBeInTheDocument();
  });

  it('o dono tira do admin com uma confirmação', async () => {
    const api = mockApi();
    const revoke = vi.spyOn(api, 'revokeAdmin');
    await abrir(api, /carla2@exemplo.com/);
    await userEvent.click(screen.getByRole('button', { name: /Tirar do admin/ }));
    expect(screen.getByText(/perde o acesso ao painel em até 1 minuto/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tirar do admin' }));
    await waitFor(() => expect(revoke).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Painel').parentElement).toHaveTextContent('sem acesso'));
  });

  it('conta do Google não vira admin, e o motivo aparece', async () => {
    await abrir(mockApi(), /ana@exemplo.com/);
    expect(screen.queryByRole('button', { name: /Tornar admin/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Conta do Google não vira admin/)).toBeInTheDocument();
  });

  it('admin comum: não vê o acesso ao painel e não mexe em outro admin', async () => {
    await abrir(comum(), /davi3@exemplo.com/);
    expect(screen.queryByRole('heading', { name: 'Acesso ao painel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Desativar a conta/ })).toBeInTheDocument();
  });

  it('admin comum na conta de outro admin: só o aviso, sem ações', async () => {
    await abrir(comum(), /carla2@exemplo.com/);
    expect(screen.getByText(/só o dono do painel desativa, exclui ou tira do admin/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Desativar a conta/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Excluir/ })).not.toBeInTheDocument();
  });
});
