import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ApiContext } from '../lib/context';
import { mockApi } from '../dev/mock';
import { sampleCamera, sampleContent, sampleCost, sampleOverview } from '../dev/fixtures';
import { OperacaoView } from '../screens/OperacaoScreen';
import { ConteudoView, PAGE_SIZE } from '../screens/ConteudoScreen';
import { ContasScreen } from '../screens/ContasScreen';
import { SquadsScreen } from '../screens/SquadsScreen';
import { CustoView } from '../screens/CustoScreen';
import { CameraScreen, CameraView, MIN_RUNS } from '../screens/CameraScreen';
import { fmtInt } from '../lib/format';
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

  it('lições puladas pelo nivelamento, por lição, com as desfeitas', () => {
    render(<OperacaoView o={sampleOverview()} />);
    const list = screen.getByRole('list', { name: 'Lições puladas pelo nivelamento' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((i) => i.textContent)).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Letras F a J');
    expect(items[0]).toHaveTextContent('34');
    expect(items[0]).toHaveTextContent('3 desfeitas');
  });

  it('sem dados ainda: textos de estado vazio', () => {
    const o = { ...sampleOverview(), lessons: [], exercises: [], signs: [], serverErrors: { collectedThrough: null, byFunction: [] } };
    render(<OperacaoView o={o} />);
    expect(screen.getByText('Ainda sem respostas por tipo de exercício.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma lição pulada pelo teste de nivelamento no período.')).toBeInTheDocument();
    expect(screen.getByText('Job diário ainda não rodou')).toBeInTheDocument();
  });
});

describe('Câmera', () => {
  const range = { from: '2026-09-24', to: '2026-10-23' };
  const glosses = (table: HTMLElement) =>
    within(table).getAllByRole('row').slice(1).map((r) => r.querySelector('.gloss')?.textContent);

  it('do mais difícil para o mais fácil, com o nível e as leituras trocadas', () => {
    const camera = sampleCamera();
    render(<CameraView camera={camera} range={range} />);
    expect(screen.getByText('Vezes na câmera').nextSibling).toHaveTextContent(fmtInt(camera.totals.runs));
    expect(screen.getByText('24 set a 23 out')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const order = glosses(table);
    expect(order[0]).toBe('K');
    expect(order).not.toContain('B'); // menos de 5 vezes fica fora
    const k = within(table).getAllByRole('row')[1];
    expect(k).toHaveTextContent('Difícil');
    expect(k).toHaveTextContent('H (61), V (22), U (8)');
    expect(within(screen.getByRole('list', { name: 'Leituras trocadas mais comuns' })).getAllByRole('listitem')[0])
      .toHaveTextContent('M lido como N');
  });

  it('filtra letras ou sinais e mostra os com poucas vezes quando pedido', async () => {
    render(<CameraView camera={sampleCamera()} range={range} />);
    await userEvent.click(screen.getByRole('radio', { name: 'Sinais' }));
    expect(glosses(screen.getByRole('table'))).toEqual(['OBRIGADO', 'TCHAU']);
    await userEvent.click(screen.getByRole('radio', { name: 'Letras' }));
    expect(screen.getByRole('status')).toHaveTextContent(`1 com menos de ${MIN_RUNS} vezes fora da lista`);
    await userEvent.click(screen.getByRole('checkbox', { name: /menos de 5 vezes/ }));
    expect(glosses(screen.getByRole('table'))).toContain('B');
  });

  it('sem números ainda: estado vazio', () => {
    const empty = { totals: { signs: 0, runs: 0, successes: 0, skips: 0, wrongReadings: 0 }, signs: [], confusions: [] };
    render(<CameraView camera={empty} range={range} />);
    expect(screen.getByText(/Ainda sem números da câmera/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a tela usa a mesma rota da Operação (mesma janela de 30 dias)', async () => {
    const api = mockApi();
    const overview = vi.spyOn(api, 'overview');
    withApi(api, <CameraScreen />);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(overview).toHaveBeenCalledTimes(1);
  });
});

describe('Conteúdo', () => {
  it('14 unidades e 255 sinais, filtro pelo que falta e páginas de 40', async () => {
    render(<ConteudoView c={sampleContent} />);
    expect(screen.getAllByRole('listitem').filter((li) => li.classList.contains('unit'))).toHaveLength(14);
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(`255 de 255 sinais, mostrando ${PAGE_SIZE}`);
    const table = () => screen.getAllByRole('table').at(-1)!;
    expect(within(table()).getAllByRole('row')).toHaveLength(PAGE_SIZE + 1);

    await userEvent.click(screen.getByRole('radio', { name: 'Sem fonte' }));
    const semFonte = sampleContent.signs.filter((s) => s.missing.includes('source')).length;
    expect(screen.getByText(`${semFonte} de 255 sinais`)).toBeInTheDocument();
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
  it('busca e mostra o resumo, sem botão de ação no resumo (as ações ficam no quadro próprio)', async () => {
    const api = mockApi();
    const account = vi.spyOn(api, 'account');
    withApi(api, <ContasScreen />);
    await screen.findByRole('list', { name: 'Contas' });
    await userEvent.type(screen.getByRole('searchbox'), 'ana');
    await userEvent.click(screen.getByRole('button', { name: /Buscar/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ana@exemplo.com/ }));
    expect(await screen.findByText('12 dias')).toBeInTheDocument();
    expect(account).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222');
    expect(screen.getByText('Turma de quinta')).toBeInTheDocument();
    expect(screen.getByText('subiu para Prata (2º de 30)')).toBeInTheDocument();
    // lição pulada pelo teste de nivelamento: sem nota, com a data em que foi pulada
    const skipped = screen.getByText('Letras F a J').closest('tr') as HTMLElement;
    expect(skipped).toHaveTextContent('pulada pelo nivelamento');
    expect(skipped).toHaveTextContent('2 out');
    expect(screen.getByText('de 57, 1 pulada pelo nivelamento')).toBeInTheDocument();
    const resumo = screen.getByLabelText('Resumo da conta');
    const labels = within(resumo).queryAllByRole('button').map((b) => b.textContent ?? '');
    expect(labels.some((l) => /excluir|apagar|validar|editar|banir|desativar/i.test(l))).toBe(false);
  });

  it('abre com todas as contas em páginas, sem precisar buscar', async () => {
    const api = mockApi();
    const list = vi.spyOn(api, 'listAccounts');
    withApi(api, <ContasScreen />);
    const lista = await screen.findByRole('list', { name: 'Contas' });
    expect(within(lista).getAllByRole('button')).toHaveLength(25);
    expect(screen.getByText('Página 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(await screen.findByText('Página 2')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Contas' })).getAllByRole('button')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(list).toHaveBeenLastCalledWith('25', undefined);

    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(await screen.findByText('Página 1')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(null, undefined);
    // uma chamada por página aberta, nada além disso
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('a busca troca a lista e "Ver todas as contas" volta para a primeira página', async () => {
    withApi(mockApi(), <ContasScreen />);
    await screen.findByRole('list', { name: 'Contas' });
    await userEvent.type(screen.getByRole('searchbox'), 'ana');
    await userEvent.click(screen.getByRole('button', { name: /Buscar/ }));
    const achadas = await screen.findByRole('list', { name: 'Contas encontradas' });
    expect(within(achadas).getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('navigation', { name: 'Páginas de contas' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver todas as contas' }));
    expect(await screen.findByText('Página 1')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('termo curto: mensagem clara', async () => {
    const { ApiError } = await import('../lib/api');
    const api = { ...mockApi(), searchAccounts: () => Promise.reject(new ApiError(400, 'BAD_QUERY', 'x')) };
    withApi(api, <ContasScreen />);
    await screen.findByRole('list', { name: 'Contas' });
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
