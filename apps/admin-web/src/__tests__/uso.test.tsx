import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ApiContext } from '../lib/context';
import { mockApi } from '../dev/mock';
import { sampleFeedbackPage, sampleUsage } from '../dev/usageFixtures';
import { FeedbackList, UsoView } from '../screens/UsoScreen';
import { httpApi, type AdminApi } from '../lib/api';
import { fmtDec } from '../lib/format';

// Tela "Uso": ativos com e sem conta, retenção, funil, lições, alcance no curso e as notas do app,
// com os comentários sempre como texto simples.

const withApi = (api: AdminApi, ui: ReactNode) => render(<ApiContext.Provider value={api}>{ui}</ApiContext.Provider>);

describe('Uso', () => {
  it('números do topo separados por conta, D1, D7 e a nota média', () => {
    const u = sampleUsage();
    render(<UsoView u={u} />);
    const hoje = screen.getByText('Ativas hoje').parentElement!;
    expect(hoje).toHaveTextContent(String(u.active.day.total));
    expect(hoje).toHaveTextContent(`${u.active.day.guest} sem conta, ${u.active.day.account} com conta`);
    expect(screen.getByText('Volta no dia seguinte (D1)').parentElement).toHaveTextContent('%');
    expect(screen.getByText('Nota média do app').parentElement).toHaveTextContent(`${fmtDec(u.feedback.average)}${u.feedback.count} notas`);
    // 30 dias de ativos sem conta e com conta
    expect(screen.getByRole('img', { name: /^Sem conta, por dia: 30 barras/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Com conta, por dia: 30 barras/ })).toBeInTheDocument();
  });

  it('funil na ordem, retenção por coorte e onde as pessoas saem', () => {
    render(<UsoView u={sampleUsage()} />);
    const funil = within(screen.getByRole('list', { name: 'Funil' })).getAllByRole('listitem');
    expect(funil.map((i) => i.querySelector('.rank-label')?.firstChild?.textContent)).toEqual([
      'Abriu o app', 'Terminou as boas-vindas', 'Concluiu a 1a lição', 'Concluiu 5 lições', 'Criou ou entrou numa conta',
    ]);
    const retencao = screen.getByRole('table', { name: 'Retenção D1 e D7 por dia de chegada' });
    expect(within(retencao).getAllByText('aguardando').length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: 'Lições mais abertas' })).toBeInTheDocument();
    expect(screen.getByText('Saem mais no exercício')).toBeInTheDocument();
    // índice do exercício contado a partir de 1 para quem lê
    expect(screen.getAllByText(/º \(/).length).toBeGreaterThan(0);
    expect(within(screen.getByRole('list', { name: 'Unidades do curso' })).getAllByRole('listitem').length).toBeGreaterThan(1);
    expect(within(screen.getByRole('list', { name: 'Notas por estrela' })).getAllByRole('listitem')[0]).toHaveTextContent('5 estrelas');
  });

  it('sem dado ainda: telas vazias explicadas', () => {
    const u = sampleUsage();
    render(<UsoView u={{ ...u, funnel: [], lessons: [], reach: [], platforms: [], retention: { ...u.retention, cohorts: u.retention.cohorts.map((c) => ({ ...c, size: 0 })) } }} />);
    expect(screen.getAllByText('Ainda sem códigos novos no período.')).toHaveLength(2);
    expect(screen.getByText('Nenhuma lição concluída ainda.')).toBeInTheDocument();
  });
});

describe('Comentários', () => {
  it('mostra o texto como texto simples, nunca como HTML, com data, nota, lições, aparelho e idioma', async () => {
    const { container } = withApi(mockApi(), <FeedbackList />);
    const list = await screen.findByRole('list', { name: /Comentários/ });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('5 de 5');
    expect(items[0]).toHaveTextContent('3 lições');
    expect(items[0]).toHaveTextContent('Android (app Android)');
    expect(items[0]).toHaveTextContent('Português');

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(6));
    const html = within(list).getAllByRole('listitem')[4];
    // o comentário com marcação aparece como digitado
    expect(html).toHaveTextContent('<b>Sem</b> som no meu celular, <script>alert(1)</script> não sei se é o app.');
    expect(container.querySelector('.uso-comments script')).toBeNull();
    expect(container.querySelector('.uso-comments b')).toBeNull();
    // sem texto: só a nota
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(8));
    expect(within(list).getAllByRole('listitem')[6]).toHaveTextContent('Sem comentário, só a nota.');
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('filtro por nota pede só aquela nota à API', async () => {
    const api = { ...mockApi(), feedback: vi.fn(async (opts?: { rating?: number | null; cursor?: string | null }) => sampleFeedbackPage(opts)) };
    withApi(api, <FeedbackList />);
    await screen.findByRole('list', { name: /Comentários/ });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nota' }), '1 estrela');
    await waitFor(() => expect(api.feedback).toHaveBeenLastCalledWith({ rating: 1, cursor: null }));
    const items = within(await screen.findByRole('list', { name: /Comentários/ })).getAllByRole('listitem');
    expect(items.every((i) => i.textContent?.includes('1 de 5'))).toBe(true);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Nota' }), '2 estrelas');
    await waitFor(() => expect(screen.getByText(/2 de 5/)).toBeInTheDocument());
  });

  it('erro da API: mensagem e tentar de novo', async () => {
    const api = { ...mockApi(), feedback: vi.fn().mockRejectedValueOnce(new Error('Falhou')).mockResolvedValue({ items: [], cursor: null }) };
    withApi(api as AdminApi, <FeedbackList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Nenhum comentário ainda.')).toBeInTheDocument();
  });
});

describe('cliente da API', () => {
  it('GET /v1/admin/usage e /v1/admin/feedback com o filtro e o cursor', async () => {
    const fetchFn = vi.fn(async () => new Response('{"items":[],"cursor":null}', { status: 200 }));
    const api = httpApi({ base: '/api', token: () => 'id-token', fetchFn: fetchFn as unknown as typeof fetch });
    await api.usage();
    await api.feedback({ rating: 4, cursor: 'abc' });
    await api.feedback();
    const urls = fetchFn.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls).toEqual(['/api/v1/admin/usage', '/api/v1/admin/feedback?rating=4&cursor=abc', '/api/v1/admin/feedback']);
  });
});
