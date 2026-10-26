import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { openDB } from 'idb';

// Entradas do modo livre: o cartão da aba Praticar e o atalho da tela da câmera levam a
// /camera/livre, que fica dentro da aba Praticar; voltar sem histórico cai em Praticar.

vi.mock('../hooks/useFreeModeCamera', () => ({
  useFreeModeCamera: () => ({
    videoRef: { current: null },
    canvasRef: { current: null },
    status: 'idle',
    view: { text: '', current: null, hint: null, hintLetter: null, lastEvent: null, handPresent: false },
    recognizable: null,
    start: vi.fn(), stop: vi.fn(), deleteLast: vi.fn(), clear: vi.fn(), addSpace: vi.fn(),
  }),
}));
vi.mock('../hooks/useCameraRecognizer', () => ({
  useCameraRecognizer: () => ({
    videoRef: { current: null }, canvasRef: { current: null }, landmarksRef: { current: null },
    status: 'idle', rawGesture: null, stableGesture: null, handPresent: false, confidence: 0, extensions: null,
    start: vi.fn(), stop: vi.fn(),
  }),
}));
vi.mock('../recognition/landmarker', () => ({ warmUpHandLandmarker: vi.fn() }));

import { routes, ROUTER_FUTURE } from '../router';
import { SessionProvider } from '../hooks/useSession';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';

async function renderAt(entries: string[]) {
  const db = await openDB(`librax-livre-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  const repo = new IdbRepo(db, 'user-livre');
  await repo.saveProfile({ userId: 'user-livre', xpTotal: 0, streak: 0, achievements: [] });
  const router = createMemoryRouter(routes, { initialEntries: entries, initialIndex: entries.length - 1, future: ROUTER_FUTURE });
  render(
    <SessionProvider repo={repo} userId="user-livre" brokenStreak={0}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>,
  );
  return router;
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
});

describe('rota do modo livre', () => {
  it('Praticar -> Modo livre -> voltar', async () => {
    const router = await renderAt(['/praticar']);
    await userEvent.click(await screen.findByRole('button', { name: /modo livre/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/camera/livre'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Modo livre' })).toBeInTheDocument();
    expect(document.querySelector('[aria-current="page"]')?.textContent).toMatch(/praticar/i);
    await userEvent.click(screen.getByRole('button', { name: /voltar/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/praticar'));
  });

  it('a tela da câmera tem o atalho para o modo livre', async () => {
    const router = await renderAt(['/camera']);
    await userEvent.click(await screen.findByRole('button', { name: /modo livre/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/camera/livre'));
  });

  it('aberto direto pelo endereço, voltar leva a Praticar', async () => {
    const router = await renderAt(['/camera/livre']);
    await userEvent.click(await screen.findByRole('button', { name: /voltar/i }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/praticar'));
  });
});
