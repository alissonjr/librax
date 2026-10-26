import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';

// O avatar VLibras não roda no jsdom: a demonstração cai na descrição em texto
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

// Câmera: o modelo da mão "carrega" na hora; a permissão é decidida em cada teste
vi.mock('../recognition/landmarker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../recognition/landmarker')>()),
  getHandLandmarker: async () => ({}),
  peekHandLandmarker: () => null,
}));

import { PlacementScreen } from '../screens/PlacementScreen';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { signsMap } from '../lib/content';
import { buildPlacementPlan, isPlacementDone, type PlacementSign } from '../lib/placement';
import { pendingEntries } from '../lib/sync';
import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider } from '../hooks/useSession';

const signs = signsMap as Record<string, PlacementSign>;
const zero = () => 0;

/** O plano que a tela monta sem câmera e sem mão em 3D (jsdom), com o sorteio fixo. */
const noCameraPlan = () => buildPlacementPlan({
  completed: new Set(),
  includeNumbers: false,
  caps: { camera: false, letterMotion: () => false, staticLetter: () => false, number: () => false, hand3d: () => false },
  signs,
  rng: zero,
});

async function newRepo() {
  const db = await openDB(`librax-placement-ui-${Date.now()}-${Math.random()}`, 3, { upgrade: (d, old) => upgradeLibraxDb(d, old) });
  const repo = new IdbRepo(db, 'user-ui');
  await repo.saveProfile({ userId: 'user-ui', xpTotal: 0, streak: 0, achievements: [] });
  return repo;
}

async function answerChoice(glossToPick: string) {
  const group = await screen.findByRole('radiogroup');
  await userEvent.click(within(group).getByRole('radio', { name: glossToPick }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
}

beforeAll(async () => {
  await import('../lib/content');
});

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

describe('PlacementScreen', () => {
  it('o convite tem um jeito claro de recusar, e recusar não muda nada', async () => {
    const repo = await newRepo();
    const onClose = vi.fn();
    render(<PlacementScreen repo={repo} userId="user-ui" onClose={onClose} onFinished={vi.fn()} rng={zero} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Começar do início' }));
    expect(onClose).toHaveBeenCalled();
    expect(isPlacementDone()).toBe(false);
    expect(await repo.getProgress('user-ui', 'u1-l1')).toBeNull();
  });

  it('sem câmera: só as primeiras lições, e o resultado pula o que a pessoa confirmou', async () => {
    const repo = await newRepo();
    const onFinished = vi.fn();
    render(<PlacementScreen repo={repo} userId="user-ui" onClose={vi.fn()} onFinished={onFinished} rng={zero} />);
    await userEvent.click(await screen.findByRole('button', { name: /fazer sem câmera/i }));

    const plan = noCameraPlan();
    expect(plan.map(it => it.lessonId)).toEqual(['u1-l1', 'u1-l1', 'u1-l2', 'u1-l2']);
    for (const item of plan) {
      expect(await screen.findByText('Qual letra é esta?')).toBeInTheDocument();
      await answerChoice(signs[item.signId].gloss);
    }

    expect(await screen.findByText('Seu resultado')).toBeInTheDocument();
    expect(screen.getByText(/você já domina 2 de 2 lições testadas/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /pular as marcadas \(2\)/i }));
    await waitFor(() => expect(onFinished).toHaveBeenCalledWith(2));
    expect(await repo.getProgress('user-ui', 'u1-l2')).toMatchObject({ status: 'completed', placement: true });
    expect(await pendingEntries()).toEqual([]);
    expect(isPlacementDone()).toBe(true);
  });

  it('"Não sei" tira o resto da lição; a pessoa pode desmarcar e não pular nada', async () => {
    const repo = await newRepo();
    const onFinished = vi.fn();
    render(<PlacementScreen repo={repo} userId="user-ui" onClose={vi.fn()} onFinished={onFinished} rng={zero} />);
    await userEvent.click(await screen.findByRole('button', { name: /fazer sem câmera/i }));
    const plan = noCameraPlan();

    await screen.findByRole('radiogroup');
    expect(screen.getByText('1/4')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Não sei' }));
    // O segundo item da lição 1 sai: vai direto para a lição 2 (e o total encolhe)
    await waitFor(() => expect(screen.getByText('2/3')).toBeInTheDocument());
    await answerChoice(signs[plan[2].signId].gloss);
    await answerChoice(signs[plan[3].signId].gloss);

    expect(await screen.findByText('Vamos estudar')).toBeInTheDocument();
    const skip = screen.getByRole('checkbox');
    expect(skip).toBeChecked();
    await userEvent.click(skip);
    await userEvent.click(screen.getByRole('button', { name: 'Começar do início' }));
    expect(onFinished).toHaveBeenCalledWith(0);
    expect(isPlacementDone()).toBe(true);
    expect(await repo.getProgress('user-ui', 'u1-l2')).toBeNull();
  });

  it('câmera indisponível no meio: avisa e segue só com reconhecimento, nas primeiras lições', async () => {
    const getUserMedia = vi.fn(async () => { throw new DOMException('negada', 'NotAllowedError'); });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
    const repo = await newRepo();
    render(<PlacementScreen repo={repo} userId="user-ui" onClose={vi.fn()} onFinished={vi.fn()} rng={zero} />);
    await userEvent.click(await screen.findByRole('button', { name: /fazer o teste/i }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(await screen.findByText(/sem câmera, o teste segue só com reconhecimento/i)).toBeInTheDocument();
    expect(await screen.findByRole('radiogroup')).toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();
  });
});

describe('entradas do teste no app', () => {
  async function renderAt(entries: string[]) {
    const repo = await newRepo();
    const router = createMemoryRouter(routes, { initialEntries: entries, future: ROUTER_FUTURE });
    render(
      <SessionProvider repo={repo} userId="user-ui" brokenStreak={0}>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </SessionProvider>,
    );
    return { router, repo };
  }

  beforeEach(() => {
    localStorage.setItem('librax_displayName', 'Ana');
  });

  it('o mapa convida no começo da unidade 1 e abre o teste', async () => {
    const { router } = await renderAt(['/aprender']);
    await userEvent.click(await screen.findByRole('button', { name: 'Fazer um teste rápido' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/nivelamento'));
  });

  it('nas Configurações, o teste aparece enquanto vale', async () => {
    await renderAt(['/configuracoes']);
    expect(await screen.findByText('Teste de nivelamento')).toBeInTheDocument();
  });

  it('com o teste feito, o mapa não convida mais', async () => {
    localStorage.setItem('librax_placementDone', '2026-10-26');
    await renderAt(['/aprender']);
    expect((await screen.findAllByText(/letras a a e/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Fazer um teste rápido' })).toBeNull();
  });
});
