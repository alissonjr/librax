import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';

// O avatar VLibras não roda no jsdom
const vlibrasState = vi.hoisted(() => ({ status: 'error', progress: 0, playing: false, speed: 1, error: 'sem avatar' }));
vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => vlibrasState,
  subscribeVlibras: () => () => {},
  attachVlibras: () => () => {},
  play: async () => false,
  retryVlibras: () => {},
  stopVlibras: () => {},
  setVlibrasSpeed: () => {},
}));

import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider, useSession } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { getToday } from '../lib/today';
import type { LeagueResult } from '../lib/leagueLocal';
import { initInstall, loadInviteState, recordInviteShown, resetInstallForTests } from '../lib/install';
import { UA, firePromptEvent, setDevice, setDisplayMode } from './installTestUtils';

let session: ReturnType<typeof useSession> | null = null;
function Probe() {
  session = useSession();
  return null;
}

/** Sem as VITE_COGNITO_* (como nos testes e no ambiente local): login indisponível. */
async function renderAt(entries: string[], opts: {
  brokenStreak?: number;
  leagueResult?: LeagueResult | null;
  lessonsCompleted?: number;
} = {}) {
  const db = await openDB(`librax-flows-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  const repo = new IdbRepo(db, 'user-test');
  await repo.saveProfile({ userId: 'user-test', xpTotal: 0, streak: 0, achievements: [], lessonsCompleted: opts.lessonsCompleted ?? 0 });
  const router = createMemoryRouter(routes, { initialEntries: entries, initialIndex: entries.length - 1, future: ROUTER_FUTURE });
  render(
    <SessionProvider repo={repo} userId="user-test" brokenStreak={opts.brokenStreak ?? 0} leagueResult={opts.leagueResult ?? null}>
      <Probe />
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>,
  );
  return router;
}

const path = (router: ReturnType<typeof createMemoryRouter>) => router.state.location.pathname;

// Telas e sheets sob demanda: transforma os módulos antes, para o findBy não estourar em máquina ocupada
beforeAll(async () => {
  initInstall();
  await Promise.all([
    import('../lib/content'), import('../lib/leagueLocal'), import('../components/LeagueResultSheet'),
    import('../screens/CourseMapScreen'), import('../screens/LessonCompletionScreen'), import('../screens/AuthScreen'),
    import('../screens/AuthCallbackScreen'), import('../screens/ProfileScreen'), import('../screens/SettingsScreen'),
    import('../screens/LeagueScreen'), import('../screens/StreakScreen'),
  ]);
});

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
  resetInstallForTests();
  setDevice(UA.firefoxDesktop);
  setDisplayMode(null);
  Object.defineProperty(navigator, 'standalone', { value: undefined, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AppOpenFlow (spec-02 12.10)', () => {
  const result: LeagueResult = {
    periodStart: Date.UTC(2026, 9, 12), fromTier: 'bronze', toTier: 'bronze', outcome: 'stayed', rank: 12, total: 30, xp: 80,
  };

  it('resultado da liga primeiro, depois a sequência quebrada, um de cada vez', async () => {
    await renderAt(['/aprender'], { leagueResult: result, brokenStreak: 5 });

    expect(await screen.findByRole('heading', { name: 'Você ficou na liga!' })).toBeInTheDocument();
    expect(screen.queryByText('Sua sequência de 5 dias acabou')).not.toBeInTheDocument();
    // Visto ao exibir, não ao fechar
    expect(localStorage.getItem('librax_leagueResultSeen')).toBe(String(result.periodStart));

    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(await screen.findByRole('heading', { name: 'Sua sequência de 5 dias acabou' })).toBeInTheDocument();
    expect(localStorage.getItem('librax_streakBrokenShownDate')).toBe(getToday());

    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('"Ver minha nova liga" leva à liga, e "Ver meu histórico" à sequência', async () => {
    const router = await renderAt(['/aprender'], { leagueResult: result, brokenStreak: 4 });
    await userEvent.click(await screen.findByRole('button', { name: 'Ver minha nova liga' }));
    await waitFor(() => expect(path(router)).toBe('/social/liga'));
    await act(() => router.navigate(-1));
    await userEvent.click(await screen.findByRole('button', { name: /Ver meu histórico/ }));
    await waitFor(() => expect(path(router)).toBe('/sequencia'));
  });
});

describe('conta sem Cognito (ambiente local)', () => {
  it('fim da lição como convidado: convite avisa que o login está indisponível e segue para o mapa', async () => {
    const router = await renderAt(['/aprender']);
    await screen.findByRole('navigation');
    await act(async () => {
      await session!.finishLesson({
        lessonId: 'u1-l1', score: 0.9, xpReward: 10, signsLearnedDelta: 3, isLastLesson: false, reviewed: [],
      });
    });
    await act(() => router.navigate('/licao/u1-l1/concluida'));
    await userEvent.click(await screen.findByRole('button', { name: /Continuar/ }));

    expect(await screen.findByRole('heading', { name: 'Salvar seu progresso' })).toBeInTheDocument();
    expect(screen.getByText(/Login indisponível neste ambiente/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar com Google' })).not.toBeInTheDocument();

    const sheet = screen.getByRole('dialog');
    await userEvent.click(sheet.querySelector('.btn-primary') as HTMLElement);
    await waitFor(() => expect(path(router)).toBe('/aprender'));
    expect(localStorage.getItem('librax_accountOfferDismissedDate')).toBe(getToday());
  });

  it('/entrar e /criar-conta mostram o estado indisponível; /auth/callback segue para o mapa', async () => {
    const router = await renderAt(['/perfil', '/entrar']);
    expect(await screen.findByRole('heading', { name: 'Login indisponível neste ambiente' })).toBeInTheDocument();
    // Sai da tela (no roteador de memória o voltar cai no padrão, a raiz)
    await userEvent.click(screen.getByRole('button', { name: 'Continuar como convidado' }));
    await waitFor(() => expect(path(router)).not.toBe('/entrar'));

    await act(() => router.navigate('/criar-conta'));
    expect(await screen.findByRole('heading', { name: 'Login indisponível neste ambiente' })).toBeInTheDocument();

    await act(() => router.navigate('/auth/callback?code=abc&state=xyz'));
    await waitFor(() => expect(path(router)).toBe('/aprender'));
  });

  it('perfil mostra convidado e leva a criar conta', async () => {
    const router = await renderAt(['/aprender', '/perfil']);
    expect(await screen.findByText('Convidado: progresso só neste aparelho')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await waitFor(() => expect(path(router)).toBe('/criar-conta'));
  });

  it('configurações oferecem entrar e criar conta', async () => {
    const router = await renderAt(['/perfil', '/configuracoes']);
    await userEvent.click(await screen.findByRole('button', { name: /Entrar na conta/ }));
    await waitFor(() => expect(path(router)).toBe('/entrar'));
  });
});

describe('instalação no fluxo real', () => {
  const title = 'Coloque o Librax na tela inicial';
  const DAY = 24 * 60 * 60 * 1000;

  it('a faixa aparece desde a primeira visita, apenas no mapa', async () => {
    setDevice(UA.iphoneSafari, 5);
    const router = await renderAt(['/aprender']);
    expect(await screen.findByRole('region', { name: 'Use o Librax como app' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(() => router.navigate('/praticar'));
    await screen.findByRole('navigation');
    expect(screen.queryByRole('region', { name: 'Use o Librax como app' })).not.toBeInTheDocument();
    await act(() => router.navigate('/licao/u1-l1'));
    await screen.findByRole('progressbar');
    expect(screen.queryByRole('region', { name: 'Use o Librax como app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
  });

  it('convidado recebe o convite após a primeira lição e depois do pedido de conta', async () => {
    setDevice(UA.iphoneSafari, 5);
    const router = await renderAt(['/aprender']);
    await screen.findByRole('navigation');
    await act(async () => {
      await session!.finishLesson({
        lessonId: 'u1-l1', score: 0.9, xpReward: 10, signsLearnedDelta: 3, isLastLesson: false, reviewed: [],
      });
    });
    await act(() => router.navigate('/licao/u1-l1/concluida'));
    await userEvent.click(await screen.findByRole('button', { name: /Continuar/ }));
    expect(await screen.findByRole('heading', { name: 'Salvar seu progresso' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('dialog').querySelector('.btn-primary') as HTMLElement);
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Use o Librax como app' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(loadInviteState()).toMatchObject({ count: 1, lessons: 1 });
    await act(() => router.navigate('/perfil'));
    await act(() => router.navigate('/aprender'));
    await screen.findByText('Meta do dia');
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Use o Librax como app' })).not.toBeInTheDocument();
  });

  it('o convite espera os outros sheets e o voltar registra a dispensa', async () => {
    setDevice(UA.iphoneSafari, 5);
    const router = await renderAt(['/aprender'], { lessonsCompleted: 1, brokenStreak: 5 });
    expect(await screen.findByRole('heading', { name: 'Sua sequência de 5 dias acabou' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: title })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    await waitFor(() => expect(router.state.historyAction).toBe('PUSH'));
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(loadInviteState().count).toBe(1);
    expect(path(router)).toBe('/aprender');
  });

  it('Android: recusar o pedido nativo registra o convite sem reabri-lo', async () => {
    setDevice(UA.androidChrome, 5);
    const event = firePromptEvent('dismissed');
    await renderAt(['/aprender'], { lessonsCompleted: 1 });
    await userEvent.click(await screen.findByRole('button', { name: 'Instalar' }));
    await waitFor(() => expect(loadInviteState().count).toBe(1));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    act(() => { firePromptEvent(); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('voltar à aba dias depois reavalia a segunda oferta, sem exigir recarregar', async () => {
    setDevice(UA.iphoneSafari, 5);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    recordInviteShown(1, now - 2 * DAY);
    await renderAt(['/aprender'], { lessonsCompleted: 2 });
    await screen.findByText('Meta do dia');
    expect(session!.suggestInstall).toBe(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    vi.setSystemTime(now + DAY);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(loadInviteState().count).toBe(2);
    expect(session!.suggestInstall).toBe(false);
  });
});
