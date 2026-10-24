import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ApiContext } from '../lib/context';
import { mockApi } from '../dev/mock';
import { sampleContent, sampleCost, sampleOverview } from '../dev/fixtures';
import { OperacaoView } from '../screens/OperacaoScreen';
import { ConteudoView, PAGE_SIZE } from '../screens/ConteudoScreen';
import { ContasScreen } from '../screens/ContasScreen';
import { SquadsScreen } from '../screens/SquadsScreen';
import { CustoView } from '../screens/CustoScreen';
import { BarChart, niceMax } from '../components/Chart';
import type { AdminApi } from '../lib/api';

const withApi = (api: AdminApi, ui: ReactNode) => render(<ApiContext.Provider value={api}>{ui}</ApiContext.Provider>);

describe('gráficos', () => {
  it('eixo com topo redondo', () => {
    expect([0, 3, 7, 12, 64, 99, 101, 4200].map(niceMax)).toEqual([1, 5, 10, 20, 100, 100, 200, 5000]);
  });

  it('cada barra tem rótulo; sem dado é diferente de zero; a tabela traz os mesmos números', async () => {
    render(<BarChart title="Por dia" measure="Erros" tone="error" data={[{ label: '1 out', value: 0 }, { label: '2 out', value: 3 }, { label: '3 out', value: null }]} />);
    expect(screen.getByRole('button', { name: '1 out: 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 out: sem dado' })).toBeInTheDocument();
    expect(screen.getByText(/barra vazada/)).toBeInTheDocument();
    await userEvent.hover(screen.getByRole('button', { name: '2 out: 3' }));
    expect(screen.getByText('2 out', { selector: '.chart-readout' })).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row').map((r) => r.textContent);
    expect(rows).toEqual(['PeríodoErros', '1 out0', '2 out3', '3 outsem dado']);
  });
});

describe('Operação', () => {
  it('números do topo, gráficos de 30 dias e rankings de desistência e erro', () => {
    const o = sampleOverview();
    render(<OperacaoView o={o} />);
    expect(screen.getByText('Ativas hoje').nextSibling).toHaveTextContent(String(o.totals.activeToday));
    const daily = screen.getAllByRole('img', { name: /^Por dia: 30 barras/ });
    expect(daily).toHaveLength(3); // ativas, lições e contas novas
    const desistem = screen.getByRole('list', { name: 'Lições com mais saídas no meio' });
    expect(within(desistem).getAllByRole('listitem')[0]).toHaveTextContent('Números 6 a 10');
    expect(screen.getByRole('list', { name: 'Lições com mais erros' })).toBeInTheDocument();
    expect(screen.getByText('Fazer o sinal na câmera')).toBeInTheDocument();
    expect(screen.getByText('CloudWatch até 22 out')).toBeInTheDocument();
  });

  it('sem dados ainda: textos de estado vazio', () => {
    const o = { ...sampleOverview(), lessons: [], exercises: [], signs: [], serverErrors: { collectedThrough: null, byFunction: [] } };
    render(<OperacaoView o={o} />);
    expect(screen.getByText('Ainda sem respostas por tipo de exercício.')).toBeInTheDocument();
    expect(screen.getByText('Job diário ainda não rodou')).toBeInTheDocument();
  });
});

describe('Conteúdo', () => {
  it('14 unidades e 254 sinais, filtro pelo que falta e páginas de 40', async () => {
    render(<ConteudoView c={sampleContent} />);
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('unit'))).toHaveLength(14);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(`254 de 254 sinais, mostrando ${PAGE_SIZE}`);
    const table = () => screen.getAllByRole('table').at(-1)!;
    expect(within(table()).getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);

    await userEvent.click(screen.getByRole('radio', { name: 'Sem fonte' }));
    const semFonte = sampleContent.signs.filter((s) => s.missing.includes('source')).length;
    expect(screen.getByText(`${semFonte} de 254 sinais`)).toBeInTheDocument();
    expect(within(table()).getAllByRole('row')).toHaveLength(semFonte + 1);

    await userEvent.click(screen.getByRole('radio', { name: 'Todos' }));
    await userEvent.click(screen.getByRole('button', { name: `Mostrar mais ${PAGE_SIZE}` }));
    expect(within(table()).getAllByRole('row')).toHaveLength(2 * PAGE_SIZE + 1);

    await userEvent.selectOptions(screen.getByRole('combobox'), 'u2');
    await userEvent.type(screen.getByRole('searchbox'), 'numero-1');
    expect(within(table()).getAllByRole('row').slice(1).map((r) => r.querySelector('.gloss')?.textContent)).toEqual(['1', '10']);
  });
});

describe('Contas', () => {
  it('busca e mostra o resumo, sem nenhum botão de ação', async () => {
    const api = mockApi();
    const account = vi.spyOn(api, 'account');
    withApi(api, <ContasScreen />);
    await userEvent.type(screen.getByRole('searchbox'), 'ana');
    await userEvent.click(screen.getByRole('button', { name: /Buscar/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ana@exemplo.com/ }));
    expect(await screen.findByText('12 dias')).toBeInTheDocument();
    expect(account).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(screen.getByText('Turma de quinta')).toBeInTheDocument();
    expect(screen.getByText('subiu para Prata (2º de 30)')).toBeInTheDocument();
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.some((l) => /excluir|apagar|validar|editar|banir/i.test(l))).toBe(false);
  });

  it('termo curto: mensagem clara', async () => {
    const { ApiError } = await import('../lib/api');
    const api = { ...mockApi(), searchAccounts: () => Promise.reject(new ApiError(400, 'BAD_QUERY', 'x')) };
    withApi(api, <ContasScreen />);
    await userEvent.type(screen.getByRole('searchbox'), 'an');
    await userEvent.click(screen.getByRole('button', { name: /Buscar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos 3 letras');
  });
});

describe('Squads', () => {
  it('lista com nome, tamanho e criação, e carrega a próxima página', async () => {
    withApi(mockApi(), <SquadsScreen />);
    expect(await screen.findByText('Turma de quinta')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: '27 de 30 membros' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Escola Bilíngue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
    expect(screen.getByText('6 squads')).toBeInTheDocument();
  });
});

describe('Custo', () => {
  it('estimativa do mês, gasto até agora e o detalhe por serviço', () => {
    render(<CustoView c={sampleCost} />);
    expect(screen.getByText('Estimado para out 2026').nextSibling).toHaveTextContent('US$ 5,41');
    expect(screen.getByText('Gasto até agora').nextSibling).toHaveTextContent('US$ 3,84');
    const services = within(screen.getByRole('list', { name: 'Gasto por serviço' })).getAllByRole('listitem');
    expect(services[0]).toHaveTextContent('Amazon CloudFront');
    expect(services[0]).toHaveTextContent('US$ 1,52');
  });

  it('antes do primeiro job diário: explica o que falta', () => {
    render(<CustoView c={{ latest: null, months: [] }} />);
    expect(screen.getByText(/Ainda sem custo guardado/)).toBeInTheDocument();
  });
});
