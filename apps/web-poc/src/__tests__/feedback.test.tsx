import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';
import { FeedbackSheet } from '../components/FeedbackSheet';
import {
  ASK_AGAIN_AFTER_LESSONS, MAX_DISMISSALS, dismissFeedbackPrompt, loadFeedbackPrompt, markFeedbackAnswered, shouldAskFeedback,
} from '../lib/feedbackPrompt';
import { KEYS, __resetTelemetryForTests, configureTelemetry, FEEDBACK_TEXT_MAX } from '../lib/telemetry';
import { PRIVACY_POLICY_VERSION } from '../lib/usageNotice';
import { I18nProvider } from '../i18n';
import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';

// Nota do app (FeedbackSheet e lib/feedbackPrompt.ts): quando perguntar, "Agora não", o envio pela
// estrela, o aviso de privacidade e o diálogo acessível.

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  __resetTelemetryForTests();
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
  configureTelemetry({ fetch: fetchMock as unknown as typeof fetch, sendBeacon: null, online: () => true, onboarded: () => true, apiBase: '/api' });
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('quando perguntar', () => {
  it('logo depois da primeira lição concluída (ou na primeira vez que der, para quem já tinha lições)', () => {
    const s = loadFeedbackPrompt();
    expect(shouldAskFeedback(s, 0)).toBe(false);
    expect(shouldAskFeedback(s, 1)).toBe(true);
    expect(shouldAskFeedback(s, 37)).toBe(true);
  });

  it('"Agora não": de novo depois de mais 3 lições, no máximo mais 2 vezes', () => {
    let s = dismissFeedbackPrompt(1);
    expect(s).toEqual({ answered: false, dismissals: 1, nextAt: 1 + ASK_AGAIN_AFTER_LESSONS });
    expect(shouldAskFeedback(s, 3)).toBe(false);
    expect(shouldAskFeedback(s, 4)).toBe(true);
    s = dismissFeedbackPrompt(4, s);
    expect(shouldAskFeedback(s, 6)).toBe(false);
    expect(shouldAskFeedback(s, 7)).toBe(true);
    s = dismissFeedbackPrompt(7, s);
    expect(s.dismissals).toBe(MAX_DISMISSALS);
    expect(shouldAskFeedback(s, 100)).toBe(false);
    // guardado no aparelho
    expect(loadFeedbackPrompt()).toEqual(s);
  });

  it('depois de mandar, nunca mais', () => {
    markFeedbackAnswered();
    expect(shouldAskFeedback(loadFeedbackPrompt(), 50)).toBe(false);
  });

  it('estado guardado estranho volta ao começo', () => {
    localStorage.setItem('librax_feedbackPrompt', '{quebrado');
    expect(loadFeedbackPrompt()).toEqual({ answered: false, dismissals: 0, nextAt: null });
  });
});

function renderSheet() {
  const onDismiss = vi.fn();
  const onDone = vi.fn();
  render(<MemoryRouter><FeedbackSheet onDismiss={onDismiss} onDone={onDone} /></MemoryRouter>);
  return { onDismiss, onDone };
}

describe('FeedbackSheet', () => {
  it('diálogo com título, aviso de privacidade, caixa opcional e cinco estrelas com nome', () => {
    renderSheet();
    const dialog = screen.getByRole('dialog', { name: 'O que você está achando do Librax?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Não escreva dados pessoais. Sua resposta não identifica você.')).toBeInTheDocument();
    const box = screen.getByLabelText('Comentário (opcional)');
    expect(box).toHaveAttribute('maxLength', String(FEEDBACK_TEXT_MAX));
    const stars = within(screen.getByRole('group', { name: 'Toque numa estrela para enviar' })).getAllByRole('button');
    expect(stars.map(b => b.getAttribute('aria-label'))).toEqual([1, 2, 3, 4, 5].map(n => `Dar nota ${n} de 5 e enviar`));
    expect(screen.getByRole('heading', { name: 'O que você está achando do Librax?' })).toHaveFocus();
  });

  it('tocar numa estrela já manda, com o texto escrito; depois agradece e não pergunta mais', async () => {
    const { onDone, onDismiss } = renderSheet();
    await userEvent.type(screen.getByLabelText('Comentário (opcional)'), 'Gosto das lições');
    await userEvent.click(screen.getByRole('button', { name: 'Dar nota 4 de 5 e enviar' }));
    expect(await screen.findByRole('heading', { name: 'Obrigado!' })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.find(([u]) => u === '/api/v1/feedback')!;
    expect(url).toBe('/api/v1/feedback');
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload).toMatchObject({ rating: 4, text: 'Gosto das lições' });
    expect(loadFeedbackPrompt().answered).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onDone).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('sem rede: agradece igual e a nota fica guardada para ir depois', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Dar nota 2 de 5 e enviar' }));
    expect(await screen.findByRole('heading', { name: 'Obrigado!' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(KEYS.feedback) ?? 'null')).toMatchObject({ rating: 2 });
  });

  it('"Agora não" e Esc fecham sem mandar', async () => {
    const first = renderSheet();
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(first.onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
    const second = renderSheet();
    await userEvent.keyboard('{Escape}');
    expect(second.onDismiss).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('o foco fica preso dentro do diálogo (Tab e Shift+Tab circulam)', async () => {
    renderSheet();
    const box = screen.getByLabelText('Comentário (opcional)');
    const later = screen.getByRole('button', { name: 'Agora não' });
    later.focus();
    await userEvent.tab();
    expect(box).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(later).toHaveFocus();
  });

  it('em inglês e espanhol, o mesmo aviso de privacidade', () => {
    localStorage.setItem('librax_lang', 'en');
    render(<I18nProvider><MemoryRouter><FeedbackSheet onDismiss={vi.fn()} onDone={vi.fn()} /></MemoryRouter></I18nProvider>);
    expect(screen.getByText('Do not write personal data. Your answer does not identify you.')).toBeInTheDocument();
    cleanup();
    localStorage.setItem('librax_lang', 'es');
    render(<I18nProvider><MemoryRouter><FeedbackSheet onDismiss={vi.fn()} onDone={vi.fn()} /></MemoryRouter></I18nProvider>);
    expect(screen.getByText('No escribas datos personales. Tu respuesta no te identifica.')).toBeInTheDocument();
  });
});

async function renderMap({ lessonsCompleted, policySeen }: { lessonsCompleted: number; policySeen: boolean }) {
  localStorage.setItem('librax_displayName', 'Bia');
  if (policySeen) localStorage.setItem('librax_policySeen', PRIVACY_POLICY_VERSION);
  // sem convite de instalar no meio (jsdom não instala)
  const db = await openDB(`librax-feedback-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  const repo = new IdbRepo(db, 'user-test');
  await repo.saveProfile({ userId: 'user-test', xpTotal: 0, streak: 0, achievements: [], lessonsCompleted });
  const router = createMemoryRouter(routes, { initialEntries: ['/aprender'], future: ROUTER_FUTURE });
  render(
    <SessionProvider repo={repo} userId="user-test" brokenStreak={0}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>,
  );
  return router;
}

describe('no mapa', () => {
  it('quem já tinha lições vê o pedido de nota ao abrir o mapa', async () => {
    await renderMap({ lessonsCompleted: 3, policySeen: true });
    expect(await screen.findByRole('dialog', { name: 'O que você está achando do Librax?' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('sem lição concluída, nada de pedido', async () => {
    await renderMap({ lessonsCompleted: 0, policySeen: true });
    await screen.findByRole('navigation', {}, { timeout: 4000 }).catch(() => null);
    await new Promise(r => setTimeout(r, 200));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('com o aviso dos dados de uso na tela, o pedido de nota espera (um aviso de cada vez)', async () => {
    await renderMap({ lessonsCompleted: 3, policySeen: false });
    expect(await screen.findByRole('heading', { name: 'Dados de uso anônimos' }, { timeout: 4000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
