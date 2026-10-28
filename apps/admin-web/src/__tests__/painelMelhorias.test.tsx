import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ApiContext } from '../lib/context';
import { mockApi } from '../dev/mock';
import { sampleAccount, sampleCost, sampleOverview, SAMPLE_USER } from '../dev/fixtures';
import { sampleFeedbackPage } from '../dev/usageFixtures';
import { attentionItems } from '../components/Attention';
import { OperacaoScreen, versus } from '../screens/OperacaoScreen';
import { CustoView } from '../screens/CustoScreen';
import { ContasScreen } from '../screens/ContasScreen';
import { FeedbackList } from '../screens/UsoScreen';
import { feedbackKey, markRead, readKeys } from '../lib/feedbackRead';
import type { AdminApi } from '../lib/api';
import type { Overview } from '../lib/types';

// Painel: o que pede atenção, período com comparação, lembretes, orçamento, comentários lidos e as
// ações sobre uma conta.

const withApi = (api: AdminApi, ui: ReactNode) =>
  render(<MemoryRouter><ApiContext.Provider value={api}>{ui}</ApiContext.Provider></MemoryRouter>);

beforeEach(() => localStorage.clear());

/** Visão calma: sem erros, sem desistência alta, sem sinal difícil e sem falha de lembrete. */
function calm(): Overview {
  const o = sampleOverview();
  return {
    ...o,
    days: o.days.map((d) => ({ ...d, serverErrors: d.serverErrors === null ? null : 0, remindersFailed: 0 })),
    lessons: o.lessons.map((l) => ({ ...l, abandon: 0, abandonRate: 0 })),
    camera: { ...o.camera, signs: o.camera.signs.map((s) => ({ ...s, level: 'ok' as const })) },
  };
}

describe('o que pede atenção', () => {
  it('tudo calmo: nenhum item', () => {
    expect(attentionItems({ o: calm(), cost: { ...sampleCost, budgetUsd: 10 }, feedback: [], read: new Set() })).toEqual([]);
  });

  it('junta notas baixas não lidas, erros de ontem, custo, desistência, câmera e lembretes', () => {
    const o = calm();
    const ontem = o.serverErrors.collectedThrough!;
    o.days = o.days.map((d) => (d.day === ontem ? { ...d, serverErrors: 4, remindersFailed: 2 } : d));
    o.lessons[0] = { ...o.lessons[0], done: 20, abandon: 10, abandonRate: 0.333 };
    o.camera.signs[0] = { ...o.camera.signs[0], level: 'hard', runs: 9 };
    const ruim = { ...sampleFeedbackPage().items[0], rating: 1 };
    const lido = { ...ruim, at: '2026-10-01T10:00:00.000Z' };
    const items = attentionItems({
      o,
      cost: { ...sampleCost, budgetUsd: 5 },
      feedback: [ruim, lido],
      read: new Set([feedbackKey(lido)]),
    });
    expect(items.map((i) => i.key)).toEqual(['notas', 'erros', 'custo', 'desistencia', 'camera', 'lembretes']);
    expect(items[0].text).toBe('1 avaliação de 1 ou 2 estrelas ainda não lida');
    expect(items.find((i) => i.key === 'custo')!.tone).toBe('error'); // previsão 5,41 acima de 5
    expect(items.find((i) => i.key === 'lembretes')!.text).toContain('2 lembretes falharam');
  });

  it('custo a partir de 80% do orçamento já avisa, sem ser urgente', () => {
    const item = attentionItems({ o: calm(), cost: { ...sampleCost, budgetUsd: 6 }, feedback: [], read: new Set() })[0];
    expect(item).toMatchObject({ key: 'custo', tone: 'warn' });
  });
});

describe('Operação', () => {
  it('compara com o período anterior do mesmo tamanho', () => {
    expect(versus(112, 100, 30)).toBe('+12% contra os 30 dias antes');
    expect(versus(80, 100, 7)).toBe('-20% contra os 7 dias antes');
    expect(versus(5, null, 7)).toBeUndefined();
    expect(versus(5, 0, 7)).toBeUndefined();
  });

  it('troca o período, mostra o resumo, a comparação e os lembretes', async () => {
    const api = mockApi();
    const overview = vi.spyOn(api, 'overview');
    withApi(api, <OperacaoScreen />);
    expect(await screen.findByRole('heading', { name: 'O que pede atenção' })).toBeInTheDocument();
    expect(overview).toHaveBeenLastCalledWith(30);
    expect(screen.getByText('Lições concluídas', { selector: '.stat-label' }).parentElement).toHaveTextContent('contra os 30 dias antes');
    const lembretes = screen.getByRole('heading', { name: 'Lembretes' }).closest('section')!;
    expect(within(lembretes).getByText('Com lembrete ligado').parentElement).toHaveTextContent('6412 com e-mail');

    await userEvent.click(screen.getByRole('radio', { name: '7 dias' }));
    await waitFor(() => expect(overview).toHaveBeenLastCalledWith(7));
    expect((await screen.findAllByText(/contra os 7 dias antes/, { selector: '.stat-hint' }, { timeout: 2000 })).length).toBe(3);
  });
});

describe('Custo', () => {
  it('mostra o orçamento e quanto a previsão usa dele', () => {
    render(<CustoView c={{ ...sampleCost, budgetUsd: 10 }} />);
    expect(screen.getByText('Orçamento do mês').parentElement).toHaveTextContent('a previsão usa 54% dele');
    expect(screen.getByRole('heading', { name: 'Previsão contra o orçamento' })).toBeInTheDocument();
  });

  it('sem orçamento conhecido, não inventa', () => {
    render(<CustoView c={{ ...sampleCost, budgetUsd: null }} />);
    expect(screen.queryByText('Orçamento do mês')).not.toBeInTheDocument();
  });
});

describe('comentários lidos', () => {
  it('novo até marcar; "marcar todos" vale para os carregados e fica guardado', async () => {
    withApi(mockApi(), <FeedbackList />);
    const lista = await screen.findByRole('list', { name: /Comentários/ });
    expect(within(lista).getAllByText('novo')).toHaveLength(3);

    await userEvent.click(within(lista).getAllByRole('button', { name: 'Marcar como lido' })[0]);
    expect(within(lista).getAllByText('novo')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Marcar todos como lidos' }));
    expect(within(lista).queryByText('novo')).not.toBeInTheDocument();
    expect(readKeys().size).toBe(3);
    expect(markRead([]).size).toBe(3);
  });
});

describe('ações na conta', () => {
  async function abrirConta(api: AdminApi) {
    withApi(api, <ContasScreen />);
    const lista = await screen.findByRole('list', { name: 'Contas' });
    await userEvent.click(within(lista).getByRole('button', { name: /ana@exemplo.com/ }));
    return screen.findByRole('heading', { name: 'Ações na conta' });
  }

  it('desativar pede confirmação e recarrega a conta', async () => {
    const api = mockApi();
    const disable = vi.spyOn(api, 'disableAccount');
    const account = vi.spyOn(api, 'account');
    await abrirConta(api);
    await userEvent.click(screen.getByRole('button', { name: /Desativar a conta/ }));
    expect(screen.getByText(/não consegue mais entrar/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(disable).toHaveBeenCalledWith(SAMPLE_USER));
    await waitFor(() => expect(account).toHaveBeenCalledTimes(2));
  });

  it('excluir só libera com o e-mail da conta digitado e volta para a lista', async () => {
    const api = mockApi();
    const del = vi.spyOn(api, 'deleteAccount');
    await abrirConta(api);
    await userEvent.click(screen.getByRole('button', { name: /Excluir a conta e os dados/ }));
    const confirmar = screen.getByRole('button', { name: 'Excluir para sempre' });
    expect(confirmar).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Digite o e-mail da conta para confirmar'), 'outra@exemplo.com');
    expect(confirmar).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Digite o e-mail da conta para confirmar'));
    await userEvent.type(screen.getByLabelText('Digite o e-mail da conta para confirmar'), 'ANA@exemplo.com');
    await userEvent.click(confirmar);
    await waitFor(() => expect(del).toHaveBeenCalledWith(SAMPLE_USER, 'ANA@exemplo.com'));
    expect(await screen.findByText('Conta excluída, com os dados dela.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ações na conta' })).not.toBeInTheDocument();
  });

  it('na própria conta não aparece nenhuma ação', async () => {
    const api = { ...mockApi(), me: () => Promise.resolve({ userId: SAMPLE_USER, email: 'ana@exemplo.com', groups: ['admin'] }) };
    withApi(api, <ContasScreen />);
    const lista = await screen.findByRole('list', { name: 'Contas' });
    await userEvent.click(within(lista).getByRole('button', { name: /ana@exemplo.com/ }));
    expect(await screen.findByText(sampleAccount.userId)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Ações na conta' })).not.toBeInTheDocument();
  });
});
