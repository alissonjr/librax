import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect, useState } from 'react';
import { render, screen, act } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { useScrollRestore } from '../hooks/useScrollRestore';
import { ROUTER_FUTURE } from '../router';

/** Tela que, como o mapa, só mostra o conteúdo depois de carregar os dados. */
function SlowScreen() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 20);
    return () => clearTimeout(timer);
  }, []);
  useScrollRestore(ready);
  return <p>{ready ? 'mapa pronto' : 'carregando'}</p>;
}

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  window.dispatchEvent(new Event('scroll'));
}

const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve(null)));

let scrollTo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  scrollTo = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  setScrollY(0);
});

describe('useScrollRestore', () => {
  it('ao voltar, restaura a posição só depois de o conteúdo carregar', async () => {
    const router = createMemoryRouter(
      [{ path: '/aprender', element: <SlowScreen /> }, { path: '/licao', element: <p>licao</p> }],
      { initialEntries: ['/aprender'], future: ROUTER_FUTURE },
    );
    render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
    await screen.findByText('mapa pronto');

    setScrollY(740);
    await act(nextFrame);

    await act(() => router.navigate('/licao'));
    await screen.findByText('licao');
    await act(() => router.navigate(-1));
    expect(screen.getByText('carregando')).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalledWith(0, 740);

    await screen.findByText('mapa pronto');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 740);
  });

  it('tela aberta de novo (não é voltar) não restaura', async () => {
    // A primeira entrada da memória tem sempre a key "default", já usada no teste anterior
    const router = createMemoryRouter(
      [{ path: '/aprender', element: <SlowScreen /> }, { path: '/licao', element: <p>licao</p> }],
      { initialEntries: ['/licao', '/aprender'], initialIndex: 1, future: ROUTER_FUTURE },
    );
    render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
    await screen.findByText('mapa pronto');
    setScrollY(500);
    await act(nextFrame);

    await act(() => router.navigate('/licao'));
    await act(() => router.navigate('/aprender'));
    await screen.findByText('mapa pronto');
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
