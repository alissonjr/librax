import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { __resetAccountForTests } from '../lib/account';
import { __resetSyncForTests, configureSync } from '../lib/sync';
import {
  inviteLink, normalizeInviteCode, pendingInvite, savePendingInvite, syncDisplayName, whatsappLink,
  type PrivateLeagueDetail,
} from '../lib/social';
import { SocialScreen } from '../screens/SocialScreen';
import { GlobalRankingScreen } from '../screens/GlobalRankingScreen';
import { PrivateLeagueScreen, privateRows } from '../screens/PrivateLeagueScreen';
import { PrivateLeagueFormScreen } from '../screens/PrivateLeagueFormScreen';
import { routes, ROUTER_FUTURE } from '../router';
import { forgetLeague } from '../lib/league';

const render = (ui: ReactElement, path = '/') => rtlRender(ui, {
  wrapper: ({ children }) => (
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
  ),
});

type Handler = (method: string, body: unknown) => { status?: number; json: unknown };
let calls: { method: string; path: string; body: unknown }[];
let api: Record<string, Handler>;

function serve() {
  configureSync({
    getSession: async () => ({ token: 'tk', userId: 'me' }),
    fetch: (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^\/api/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path, body });
      const h = api[`${method} ${path}`];
      if (!h) return new Response(JSON.stringify({ error: { code: 'NOT_MOCKED' } }), { status: 500 });
      const out = h(method, body);
      return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
    }) as unknown as typeof fetch,
  });
}

const detail = (over: Partial<PrivateLeagueDetail> = {}): PrivateLeagueDetail => ({
  squad: { squadId: 'sq1', name: 'Turma da Ana', memberCount: 3, maxMembers: 30, xpWeekly: 70, inviteCode: 'ABC234' },
  members: [
    { userId: 'me', displayName: 'Nome velho', role: 'admin', xpWeeklyContrib: 20, xpAllTimeContrib: 500 },
    { userId: 'b', displayName: 'Bruno', role: 'member', xpWeeklyContrib: 50, xpAllTimeContrib: 100 },
    { userId: 'c', displayName: null, role: 'member', xpWeeklyContrib: 0, xpAllTimeContrib: 100 },
  ],
  membersVisible: true,
  userMembership: { role: 'admin' },
  ...over,
});

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
  calls = [];
  api = {};
  forgetLeague();
  __resetSyncForTests();
  __resetAccountForTests({ status: 'signedIn', email: 'ana@exemplo.com' });
  serve();
});

afterEach(() => {
  __resetAccountForTests();
  __resetSyncForTests();
  vi.restoreAllMocks();
});

describe('convite', () => {
  it('código em maiúsculas, só letras e números, 6 no máximo', () => {
    expect(normalizeInviteCode(' ab-c 23 4xyz')).toBe('ABC234');
  });

  it('link no endereço do app e link do WhatsApp com a mensagem pronta', () => {
    expect(inviteLink('ABC234', 'https://app.librax.online')).toBe('https://app.librax.online/convite/ABC234');
    expect(whatsappLink('Entre: https://x/convite/ABC234')).toBe('https://wa.me/?text=Entre%3A%20https%3A%2F%2Fx%2Fconvite%2FABC234');
  });

  it('/convite/<código> guarda o código e abre a tela de entrar com ele', async () => {
    const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
    const router = createMemoryRouter(routes, { initialEntries: ['/convite/abc234'], future: ROUTER_FUTURE });
    const { SessionProvider } = await import('../hooks/useSession');
    const { IdbRepo } = await import('../lib/idbRepo');
    const { openDB } = await import('idb');
    const { upgradeLibraxDb } = await import('../lib/db');
    const db = await openDB(`librax-invite-${Math.random()}`, 3, { upgrade: (d, v) => upgradeLibraxDb(d, v) });
    const repo = new IdbRepo(db, 'me');
    await repo.saveProfile({ userId: 'me', xpTotal: 0, streak: 0, achievements: [] });
    api['POST /v1/squads/join'] = () => ({ json: detail().squad });
    api['GET /v1/squads/sq1'] = () => ({ json: detail() });
    rtlRender(
      <SessionProvider repo={repo} userId="me" brokenStreak={0}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </SessionProvider>,
    );
    // Com conta, entra sozinho e abre a liga
    await waitFor(() => expect(router.state.location.pathname).toBe('/social/ligas/sq1'));
    expect(calls).toContainEqual({ method: 'POST', path: '/v1/squads/join', body: { inviteCode: 'ABC234' } });
    // Usado: não fica como convite pendente
    expect(pendingInvite()).toBeNull();
  });
});

describe('nome no servidor', () => {
  it('manda o nome do aparelho uma vez por nome', async () => {
    api['PUT /v1/users/me/profile'] = (_m, body) => ({ json: { ...(body as object), showInGlobalRanking: true } });
    await syncDisplayName();
    await syncDisplayName();
    expect(calls.filter(c => c.method === 'PUT')).toEqual([{ method: 'PUT', path: '/v1/users/me/profile', body: { displayName: 'Ana' } }]);
    localStorage.setItem('librax_displayName', 'Ana Paula');
    await syncDisplayName();
    expect(calls.filter(c => c.method === 'PUT')).toHaveLength(2);
  });

  it('num aparelho novo, a escolha da liga geral vem da conta', async () => {
    api['PUT /v1/users/me/profile'] = () => ({ json: { displayName: 'Ana', showInGlobalRanking: false } });
    const { showInGlobalRanking } = await import('../lib/social');
    expect(showInGlobalRanking()).toBe(true);
    await syncDisplayName();
    expect(showInGlobalRanking()).toBe(false);
  });
});

describe('aba Social', () => {
  const handlers = () => ({
    onOpenLeague: vi.fn(), onOpenGlobal: vi.fn(), onOpenPrivate: vi.fn(),
    onCreatePrivate: vi.fn(), onJoinPrivate: vi.fn(), onAccount: vi.fn(),
  });

  it('ligas fixas e as privadas da pessoa, com criar e entrar com código', async () => {
    api['GET /v1/users/me/squads'] = () => ({ json: { squads: [detail().squad] } });
    api['GET /v1/league/current'] = () => ({ json: { enrolled: false, tier: 'bronze', leagueId: null, week: 43, period: '2026-w43', periodStart: 0, periodEnd: 1, rows: [], you: null, promote: 3, relegate: 0, pendingResult: null } });
    const h = handlers();
    render(<SocialScreen {...h} />);
    await userEvent.click(await screen.findByRole('button', { name: /Turma da Ana/ }));
    expect(h.onOpenPrivate).toHaveBeenCalledWith('sq1');
    expect(screen.getByRole('button', { name: /Turma da Ana/ })).toHaveTextContent('3 pessoas · 70 XP na semana');
    await userEvent.click(screen.getByRole('button', { name: /Liga geral/ }));
    expect(h.onOpenGlobal).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Criar liga/ }));
    expect(h.onCreatePrivate).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Entrar com código/ }));
    expect(h.onJoinPrivate).toHaveBeenCalledWith();
    expect(await screen.findByText('Conclua uma lição para entrar na sua primeira liga')).toBeInTheDocument();
  });

  it('convite guardado aparece para entrar', async () => {
    savePendingInvite('xyz789');
    api['GET /v1/users/me/squads'] = () => ({ json: { squads: [] } });
    api['GET /v1/league/current'] = () => ({ status: 500, json: {} });
    const h = handlers();
    render(<SocialScreen {...h} />);
    expect(await screen.findByText('Você recebeu um convite para uma liga (código XYZ789).')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Entrar' }));
    expect(h.onJoinPrivate).toHaveBeenCalledWith('XYZ789');
  });

  it('sem conta: convite para criar conta, sem chamar a API', async () => {
    __resetAccountForTests({ status: 'guest', email: null });
    const h = handlers();
    render(<SocialScreen {...h} />);
    expect(screen.getByText('Crie uma conta para entrar nas ligas')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    expect(h.onAccount).toHaveBeenCalledWith('register');
    expect(screen.queryByRole('button', { name: /Criar liga/ })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('liga geral', () => {
  it('top da lista e a sua posição quando fica fora dele', async () => {
    api['GET /v1/ranking/global'] = () => ({
      json: {
        top: [{ rank: 1, name: 'Carla', xp: 900, isYou: false }, { rank: 1, name: null, xp: 900, isYou: false }, { rank: 3, name: 'Davi', xp: 800, isYou: false }],
        you: { rank: 57, xp: 120, listed: true },
      },
    });
    render(<GlobalRankingScreen onBack={vi.fn()} onAccount={vi.fn()} onOpenSettings={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Ranking da liga geral' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('1º lugar, Carla, 900 XP');
    // Empate divide a posição; sem nome, "Estudante"
    expect(items[1]).toHaveTextContent('1º lugar, Estudante, 900 XP');
    expect(screen.getByText('57º lugar')).toBeInTheDocument();
    expect(screen.getByText('120 XP')).toBeInTheDocument();
  });

  it('quem desligou a liga geral vê o aviso e o caminho para Configurações', async () => {
    api['GET /v1/ranking/global'] = () => ({ json: { top: [{ rank: 1, name: 'Carla', xp: 900, isYou: false }], you: { rank: null, xp: 120, listed: false } } });
    const onOpenSettings = vi.fn();
    render(<GlobalRankingScreen onBack={vi.fn()} onAccount={vi.fn()} onOpenSettings={onOpenSettings} />);
    expect(await screen.findByText('Você não aparece na liga geral.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mudar em Configurações' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe('liga privada', () => {
  it('ranking da semana e total, com empate dividindo a posição', () => {
    const d = { ...detail(), me: 'me' };
    expect(privateRows(d, 'week', 'Ana', 'Estudante', 'me').map(r => [r.rank, r.name, r.xp])).toEqual([
      [1, 'Bruno', 50], [2, 'Ana', 20], [3, 'Estudante', 0],
    ]);
    expect(privateRows(d, 'total', 'Ana', 'Estudante', 'me').map(r => [r.rank, r.name, r.xp])).toEqual([
      [1, 'Ana', 500], [2, 'Bruno', 100], [2, 'Estudante', 100],
    ]);
  });

  it('código com copiar, compartilhar e WhatsApp; abas da semana e total', async () => {
    api['GET /v1/squads/sq1'] = () => ({ json: detail() });
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    const showNotice = vi.fn();
    render(<PrivateLeagueScreen leagueId="sq1" onBack={vi.fn()} onGone={vi.fn()} showNotice={showNotice} justCreated />);

    expect(await screen.findByRole('heading', { name: 'Liga criada! Agora convide as pessoas' })).toBeInTheDocument();
    expect(screen.getByText('ABC234')).toBeInTheDocument();
    const wa = screen.getByRole('link', { name: 'WhatsApp' });
    expect(wa.getAttribute('href')).toContain('https://wa.me/?text=');
    expect(decodeURIComponent(wa.getAttribute('href')!)).toContain('/convite/ABC234');

    await userEvent.click(screen.getByRole('button', { name: /Compartilhar/ }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/convite/ABC234') }));

    const list = screen.getByRole('list', { name: 'Ranking da liga Turma da Ana' });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('1º lugar, Bruno, 50 XP');
    await userEvent.click(screen.getByRole('radio', { name: 'Total' }));
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent('1º lugar, Ana (Você), 500 XP');
    Reflect.deleteProperty(navigator, 'share');
  });

  it('quem criou apaga a liga, com confirmação', async () => {
    api['GET /v1/squads/sq1'] = () => ({ json: detail() });
    api['DELETE /v1/squads/sq1'] = () => ({ json: { ok: true } });
    const onGone = vi.fn();
    render(<PrivateLeagueScreen leagueId="sq1" onBack={vi.fn()} onGone={onGone} showNotice={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Apagar liga/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Apagar "Turma da Ana"?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apagar liga' }));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Sair da liga/ })).not.toBeInTheDocument();
  });

  it('membro sai da liga', async () => {
    api['GET /v1/squads/sq1'] = () => ({ json: detail({ userMembership: { role: 'member' } }) });
    api['POST /v1/squads/sq1/leave'] = () => ({ json: { ok: true } });
    const onGone = vi.fn();
    render(<PrivateLeagueScreen leagueId="sq1" onBack={vi.fn()} onGone={onGone} showNotice={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Sair da liga/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sair da liga' }));
    await waitFor(() => expect(onGone).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Gerar outro código/ })).not.toBeInTheDocument();
  });
});

describe('criar e entrar', () => {
  function DoneProbe() {
    const { id } = useParams();
    return <p>liga {id}</p>;
  }

  it('cria a liga privada com o nome e abre ela', async () => {
    api['POST /v1/squads'] = (_m, body) => ({ status: 201, json: { ...detail().squad, name: (body as { name: string }).name } });
    const onDone = vi.fn();
    render(<PrivateLeagueFormScreen mode="create" onBack={vi.fn()} onDone={onDone} onAccount={vi.fn()} />);
    const create = screen.getByRole('button', { name: 'Criar liga' });
    expect(create).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Nome da liga'), 'Família');
    await userEvent.click(create);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ squadId: 'sq1' })));
    expect(calls).toContainEqual({ method: 'POST', path: '/v1/squads', body: { name: 'Família', type: 'private' } });
  });

  it('código errado mostra o erro na hora', async () => {
    api['POST /v1/squads/join'] = () => ({ status: 404, json: { error: { code: 'SQUAD_NOT_FOUND' } } });
    render(
      <Routes>
        <Route path="/" element={<PrivateLeagueFormScreen mode="join" onBack={vi.fn()} onDone={vi.fn()} onAccount={vi.fn()} />} />
        <Route path="/l/:id" element={<DoneProbe />} />
      </Routes>,
    );
    await userEvent.type(screen.getByLabelText('Código da liga'), 'zzz-999');
    expect(screen.getByLabelText('Código da liga')).toHaveValue('ZZZ999');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não achamos uma liga com esse código');
  });

  it('limite de ligas vem com a mensagem certa', async () => {
    api['POST /v1/squads'] = () => ({ status: 409, json: { error: { code: 'SQUADS_LIMIT_REACHED' } } });
    render(<PrivateLeagueFormScreen mode="create" onBack={vi.fn()} onDone={vi.fn()} onAccount={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Nome da liga'), 'Mais uma');
    await userEvent.click(screen.getByRole('button', { name: 'Criar liga' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você já está em 5 ligas privadas');
  });
});

describe('convite de uma liga em que a pessoa já está', () => {
  it('abre a liga em vez de mostrar erro', async () => {
    api['POST /v1/squads/join'] = () => ({ status: 409, json: { error: { code: 'ALREADY_MEMBER' } } });
    api['GET /v1/users/me/squads'] = () => ({ json: { squads: [detail().squad] } });
    const onDone = vi.fn();
    render(<PrivateLeagueFormScreen mode="join" initialCode="abc234" onBack={vi.fn()} onDone={onDone} onAccount={vi.fn()} />);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ squadId: 'sq1' })));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
