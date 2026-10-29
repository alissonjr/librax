import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LeagueScreen, formatTimeLeft } from '../screens/LeagueScreen';
import { forgetLeague, type LeagueView, type RankingRow } from '../lib/league';
import { __resetAccountForTests } from '../lib/account';
import { __resetSyncForTests, configureSync } from '../lib/sync';
import { useT } from '../i18n';
import { launchConfetti } from '../lib/confetti';
import { tokens } from '../styles/tokens';

vi.mock('../lib/confetti', () => ({ launchConfetti: vi.fn() }));

// Sheets e diálogos usam o histórico do roteador (useCloseOnBack)
const render = (ui: ReactElement) => rtlRender(ui, {
  wrapper: ({ children }) => (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
  ),
});

const DAY = 24 * 60 * 60 * 1000;
const MONDAY = Date.UTC(2026, 9, 19);
const WED = MONDAY + 2 * DAY + 12 * 60 * 60 * 1000;
const nowWed = () => WED;

/** Visão no formato do GET /v1/league/current (services/api/src/domain/leagues.js, buildLeagueView). */
function view(over: Partial<LeagueView> = {}): LeagueView {
  return {
    enrolled: true, tier: 'prata', leagueId: 'prata-2026-w43', week: 43, period: '2026-w43',
    periodStart: MONDAY, periodEnd: MONDAY + 7 * DAY, rows: [], you: null, promote: 3, relegate: 10,
    pendingResult: null, ...over,
  };
}

function rows(n: number, meAt: number, meXp = 40): RankingRow[] {
  return Array.from({ length: n }, (_, i) => {
    const promote = i < 3;
    const relegate = n >= 13 && i >= n - 10;
    return {
      userId: i === meAt ? 'me' : `u${i}`,
      name: i === meAt ? 'Nome no servidor' : i === 1 ? null : `Pessoa ${i}`,
      xpPeriod: i === meAt ? meXp : 500 - i,
      rank: i + 1,
      zone: promote ? 'promotion' : relegate ? 'relegation' : 'stay',
      isYou: i === meAt,
    };
  });
}

let calls: { method: string; url: string; body: unknown }[];
let league: unknown;

function serve(status = 200) {
  configureSync({
    getSession: async () => ({ token: 'tk', userId: 'me' }),
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.endsWith('/v1/league/current')) return new Response(JSON.stringify(league), { status });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
  });
}

beforeEach(() => {
  vi.mocked(launchConfetti).mockClear();
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Alice');
  calls = [];
  league = view();
  forgetLeague();
  __resetSyncForTests();
  __resetAccountForTests({ status: 'signedIn', email: 'alice@exemplo.com' });
  serve();
});

afterEach(() => {
  __resetAccountForTests();
  __resetSyncForTests();
});

describe('LeagueScreen', () => {
  it('sem conta: convite para criar conta, sem ranking inventado', async () => {
    __resetAccountForTests({ status: 'guest', email: null });
    const onAccount = vi.fn();
    render(<LeagueScreen onBack={vi.fn()} onAccount={onAccount} now={nowWed} />);
    expect(await screen.findByRole('heading', { name: 'Ligas são com conta' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: /ranking/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(onAccount).toHaveBeenCalledWith('register');
    await userEvent.click(screen.getByRole('button', { name: 'Já tenho conta' }));
    expect(onAccount).toHaveBeenCalledWith('login');
    expect(calls).toHaveLength(0);
  });

  it('ainda sem liga na semana: entra na liga certa ao concluir uma lição', async () => {
    league = view({ enrolled: false, tier: 'ouro', leagueId: null });
    const onStudy = vi.fn();
    render(<LeagueScreen onBack={vi.fn()} onStudy={onStudy} onAccount={vi.fn()} now={nowWed} />);
    expect(await screen.findByText(/sua primeira liga começa em breve/i)).toBeInTheDocument();
    expect(screen.getByText(/entrar na Liga Ouro desta semana/)).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('A semana fecha em 4d 12h');
    await userEvent.click(screen.getByRole('button', { name: /estudar agora/i }));
    expect(onStudy).toHaveBeenCalled();
  });

  it('ranking do servidor com zonas por seta e texto, e a pessoa destacada com o nome do aparelho', async () => {
    league = view({ rows: rows(30, 4) });
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Liga Prata' })).toBeInTheDocument();
    expect(screen.getByText('Semana 43')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Encerra em 4d 12h');
    expect(screen.getByText('Top 3 sobem para a Liga Ouro')).toBeInTheDocument();
    expect(screen.getByText('Últimos 10 descem para a Liga Bronze')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: /ranking da semana/i });
    const items = within(list).getAllByRole('listitem').filter(li => !li.getAttribute('aria-hidden'));
    expect(items).toHaveLength(30);
    expect(items[0]).toHaveTextContent(/1º lugar, Pessoa 0, 500 XP, zona de promoção/);
    // Sem nome no servidor: "Estudante"
    expect(items[1]).toHaveTextContent(/2º lugar, Estudante, 499 XP/);
    expect(items[29]).toHaveTextContent(/30º lugar, .+, zona de rebaixamento/);
    expect(screen.getByText('Zona de promoção')).toBeInTheDocument();
    expect(screen.getByText('Zona de rebaixamento')).toBeInTheDocument();

    const me = items.find(r => r.getAttribute('aria-current') === 'true')!;
    expect(me).toHaveTextContent('Alice (Você)');
    expect(me).toHaveTextContent('40 XP');
    // Liga cheia: sem aviso de que ainda está enchendo, e nada de "simulado"
    expect(screen.queryByText(/enche conforme/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/simulad/i)).not.toBeInTheDocument();
    // Pede a liga com a conta, depois de mandar a fila de lições
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/league/current' });
  });

  it('liga com pouca gente: mostra quem tem e avisa que ela enche durante a semana', async () => {
    league = view({ tier: 'bronze', promote: 3, relegate: 0, rows: rows(4, 0) });
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);
    const list = await screen.findByRole('list', { name: /ranking da semana/i });
    expect(within(list).getAllByRole('listitem').filter(li => !li.getAttribute('aria-hidden'))).toHaveLength(4);
    expect(screen.getByText('Sua liga tem 4 pessoas por enquanto. Ela enche conforme mais gente estuda nesta semana.')).toBeInTheDocument();
  });

  it('sem conexão: pede para tentar de novo e tenta', async () => {
    serve(500);
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);
    expect(await screen.findByRole('heading', { name: 'Sem conexão' })).toBeInTheDocument();
    serve();
    league = view({ rows: rows(5, 0) });
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Liga Prata' })).toBeInTheDocument();
  });

  it('mostra o resultado pendente, marca como visto no aparelho e no servidor', async () => {
    league = view({
      tier: 'ouro', rows: rows(5, 0),
      pendingResult: { period: '2026-w42', periodStart: MONDAY - 7 * DAY, fromTier: 'prata', toTier: 'ouro', outcome: 'promoted', rank: 1, total: 30, xp: 900 },
    });
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Você subiu de liga!' })).toBeInTheDocument();
    expect(within(dialog).getByText('Excelente semana! Continue assim na Liga Ouro.')).toBeInTheDocument();
    expect(within(dialog).getByText('#1')).toBeInTheDocument();
    expect(within(dialog).getByText('Posição final de 30 membros')).toBeInTheDocument();
    expect(localStorage.getItem('librax_leagueResultSeen')).toBe('2026-w42');
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', url: '/api/v1/league/result-seen', body: { period: '2026-w42' } }));
    expect(launchConfetti).toHaveBeenCalledWith(40, 2000, expect.arrayContaining([tokens['league.ouro.fill']]));

    await userEvent.click(within(dialog).getByRole('button', { name: /ver minha nova liga/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Liga Ouro' })).toBeInTheDocument();
  });

  it('resultado já mostrado neste aparelho não reaparece, mesmo antes do servidor saber', async () => {
    localStorage.setItem('librax_leagueResultSeen', '2026-w42');
    league = view({
      rows: rows(5, 0),
      pendingResult: { period: '2026-w42', periodStart: MONDAY - 7 * DAY, fromTier: 'rubi', toTier: 'safira', outcome: 'relegated', rank: 28, total: 30, xp: 10 },
    });
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);
    await screen.findByRole('heading', { level: 1, name: 'Liga Prata' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rebaixamento tem tom neutro', async () => {
    league = view({
      tier: 'safira', rows: rows(5, 0),
      pendingResult: { period: '2026-w42', periodStart: MONDAY - 7 * DAY, fromTier: 'rubi', toTier: 'safira', outcome: 'relegated', rank: 28, total: 30, xp: 10 },
    });
    render(<LeagueScreen onBack={vi.fn()} onAccount={vi.fn()} now={nowWed} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Você desceu de liga.')).toBeInTheDocument();
    expect(within(dialog).getByText(/acontece\. uma semana de estudo consistente/i)).toBeInTheDocument();
    expect(launchConfetti).not.toHaveBeenCalled();
  });
});

describe('formatTimeLeft', () => {
  function Probe({ ms }: { ms: number }) {
    const { t } = useT();
    return <span>{formatTimeLeft(t, 0, ms)}</span>;
  }
  it('formata dias, horas e minutos', () => {
    const { rerender } = rtlRender(<Probe ms={2 * DAY + 5 * 3600_000} />);
    expect(screen.getByText('2d 5h')).toBeInTheDocument();
    rerender(<Probe ms={5 * 3600_000 + 12 * 60_000} />);
    expect(screen.getByText('5h 12min')).toBeInTheDocument();
    rerender(<Probe ms={30_000} />);
    expect(screen.getByText('1min')).toBeInTheDocument();
  });
});
