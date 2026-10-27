import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReminderSettings } from '../components/ReminderSettings';
import { configureReminders, __resetRemindersForTests, type ReminderDeps } from '../lib/reminders';

// Grupo "Lembretes" das Configurações (components/ReminderSettings.tsx), com a API falsa.

const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

function setup(over: Partial<ReminderDeps> = {}) {
  const fetch = vi.fn(async () => Response.json({ ok: true }));
  const data = new Map<string, string>();
  configureReminders({
    fetch: fetch as unknown as typeof globalThis.fetch,
    getSession: async () => ({ token: 'id-token', userId: 'sub-1' }),
    apiBase: '/api',
    vapidKey: '',
    emailEnabled: true,
    storage: {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    },
    timeZone: () => 'America/Sao_Paulo',
    online: () => true,
    push: () => null,
    ios: () => false,
    standalone: () => false,
    ...over,
  });
  return { fetch };
}

beforeEach(() => __resetRemindersForTests());

describe('Lembretes nas Configurações', () => {
  it('sem nenhum lembrete ligado na infra, o grupo não aparece', () => {
    setup({ emailEnabled: false });
    const { container } = render(<ReminderSettings signedIn />);
    expect(container).toBeEmptyDOMElement();
  });

  it('sem conta: convida a criar uma', async () => {
    setup();
    const onOpenAccount = vi.fn();
    render(<ReminderSettings signedIn={false} onOpenAccount={onOpenAccount} />);
    await userEvent.click(screen.getByRole('button', { name: /Crie uma conta para receber um lembrete por dia/ }));
    expect(onOpenAccount).toHaveBeenCalledWith('register');
  });

  it('com conta: ligar o e-mail manda as escolhas e mostra o horário', async () => {
    const { fetch } = setup();
    render(<ReminderSettings signedIn />);
    const email = await screen.findByRole('switch', { name: /Lembrete por e-mail/ });
    expect(email).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('combobox', { name: 'Horário do lembrete' })).not.toBeInTheDocument();

    await userEvent.click(email);

    await waitFor(() => expect(screen.getByRole('switch', { name: /Lembrete por e-mail/ })).toHaveAttribute('aria-checked', 'true'));
    expect(fetch).toHaveBeenCalledWith('/api/v1/notifications/preferences', expect.objectContaining({ method: 'PUT' }));
    const hora = screen.getByRole('combobox', { name: 'Horário do lembrete' });
    expect(hora).toHaveValue('19');
    expect(screen.getByRole('option', { name: '07:00' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '22:00' })).not.toBeInTheDocument();
  });

  it('erro ao salvar vira aviso, e o interruptor fica como estava', async () => {
    const onNotice = vi.fn();
    setup({ fetch: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch });
    render(<ReminderSettings signedIn onNotice={onNotice} />);
    await userEvent.click(await screen.findByRole('switch', { name: /Lembrete por e-mail/ }));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith('reminders.errors.error'));
    expect(screen.getByRole('switch', { name: /Lembrete por e-mail/ })).toHaveAttribute('aria-checked', 'false');
  });

  it('iPhone no navegador: explica que precisa instalar para a notificação', async () => {
    setup({ vapidKey: VAPID, emailEnabled: false, ios: () => true });
    render(<ReminderSettings signedIn />);
    expect(await screen.findByText(/instale o app na tela inicial para receber notificações/)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
