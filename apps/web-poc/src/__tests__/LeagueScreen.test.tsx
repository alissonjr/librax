import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LeagueScreen, formatTimeLeft } from '../screens/LeagueScreen';
import { leagueIdOf, type LeagueRepo, type LeagueState } from '../lib/leagueLocal';
import { useT } from '../i18n';
import { launchConfetti } from '../lib/confetti';
import { tokens } from '../styles/tokens';

vi.mock('../lib/confetti', () => ({ launchConfetti: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const MONDAY = Date.UTC(2026, 9, 19);
const WED = MONDAY + 2 * DAY + 12 * 60 * 60 * 1000;

class MemRepo implements LeagueRepo {
  state: LeagueState | null = null;
  xp = new Map<string, number>();
  async getLeagueState() { return this.state; }
  async saveLeagueState(s: LeagueState) { this.state = s; }
  async getLeagueMemberXp(l: string, u: string) { return this.xp.get(`${l}#${u}`) ?? 0; }
  async setLeagueMemberXp(l: string, u: string, v: number) { this.xp.set(`${l}#${u}`, v); }
  async getDayXp() { return 0; }
}

let repo: MemRepo;
beforeEach(() => {
  vi.mocked(launchConfetti).mockClear();
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Alice');
  repo = new MemRepo();
});

const nowWed = () => WED;

describe('LeagueScreen', () => {
  it('estado vazio: primeira liga em breve, com contagem até o fechamento', async () => {
    const onStudy = vi.fn();
    render(<LeagueScreen userId="me" repo={repo} onBack={vi.fn()} onStudy={onStudy} now={nowWed} />);
    expect(await screen.findByText(/sua primeira liga começa em breve/i)).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('A semana fecha em 4d 12h');
    await userEvent.click(screen.getByRole('button', { name: /estudar agora/i }));
    expect(onStudy).toHaveBeenCalled();
  });

  it('ranking com zonas marcadas por seta e texto, e a pessoa destacada', async () => {
    repo.state = { userId: 'me', tier: 'prata', periodStart: MONDAY };
    repo.xp.set(`${leagueIdOf('prata', MONDAY)}#me`, 40);
    render(<LeagueScreen userId="me" repo={repo} onBack={vi.fn()} now={nowWed} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Liga Prata' })).toBeInTheDocument();
    expect(screen.getByText('Semana 43')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent('Encerra em 4d 12h');
    expect(screen.getByText('Top 3 sobem para a Liga Ouro')).toBeInTheDocument();
    expect(screen.getByText('Últimos 10 descem para a Liga Bronze')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: /ranking da semana/i });
    const rows = within(list).getAllByRole('listitem').filter(li => !li.getAttribute('aria-hidden'));
    expect(rows).toHaveLength(30);
    expect(rows[0]).toHaveTextContent(/1º lugar, .+, \d+ XP, zona de promoção/);
    expect(rows[29]).toHaveTextContent(/30º lugar, .+, zona de rebaixamento/);
    // Divisórias com texto, além da cor
    expect(screen.getByText('Zona de promoção')).toBeInTheDocument();
    expect(screen.getByText('Zona de rebaixamento')).toBeInTheDocument();

    const me = rows.find(r => r.getAttribute('aria-current') === 'true')!;
    expect(me).toHaveTextContent('Alice (Você)');
    expect(me).toHaveTextContent('40 XP');
    // Modo local/demo dito na tela
    expect(screen.getByText(/participantes são simulados/i)).toBeInTheDocument();
  });

  it('mostra o resultado pendente uma vez e marca como visto ao exibir', async () => {
    repo.state = { userId: 'me', tier: 'prata', periodStart: MONDAY - 7 * DAY };
    repo.xp.set(`${leagueIdOf('prata', MONDAY - 7 * DAY)}#me`, 99999);
    const { unmount } = render(<LeagueScreen userId="me" repo={repo} onBack={vi.fn()} now={nowWed} />);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Você subiu de liga!' })).toBeInTheDocument();
    expect(within(dialog).getByText('Excelente semana! Continue assim na Liga Ouro.')).toBeInTheDocument();
    expect(within(dialog).getByText('#1')).toBeInTheDocument();
    expect(within(dialog).getByText('Posição final de 30 membros')).toBeInTheDocument();
    expect(localStorage.getItem('librax_leagueResultSeen')).toBe(String(MONDAY - 7 * DAY));
    // Confete na cor da liga nova (spec-05 5.2)
    expect(launchConfetti).toHaveBeenCalledWith(40, 2000, expect.arrayContaining([tokens['league.ouro.fill']]));

    await userEvent.click(within(dialog).getByRole('button', { name: /ver minha nova liga/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Liga Ouro' })).toBeInTheDocument();
    unmount();

    render(<LeagueScreen userId="me" repo={repo} onBack={vi.fn()} now={nowWed} />);
    await screen.findByRole('heading', { level: 1, name: 'Liga Ouro' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rebaixamento tem tom neutro', async () => {
    repo.state = { userId: 'me', tier: 'rubi', periodStart: MONDAY - 7 * DAY };
    render(<LeagueScreen userId="me" repo={repo} onBack={vi.fn()} now={nowWed} />);
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
    const { rerender } = render(<Probe ms={2 * DAY + 5 * 3600_000} />);
    expect(screen.getByText('2d 5h')).toBeInTheDocument();
    rerender(<Probe ms={5 * 3600_000 + 12 * 60_000} />);
    expect(screen.getByText('5h 12min')).toBeInTheDocument();
    rerender(<Probe ms={30_000} />);
    expect(screen.getByText('1min')).toBeInTheDocument();
  });
});
