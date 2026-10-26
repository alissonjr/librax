import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import { AppUpdateNotice } from '../components/AppUpdateNotice';
import * as updates from '../lib/appUpdate';
import { versionId } from '../lib/appVersion';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  updates.resetAppUpdate();
});
afterEach(() => {
  cleanup();
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function serviceWorkerWindow(controlled = true) {
  const sw = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
    getRegistration: vi.fn(),
  });
  const update = vi.fn().mockResolvedValue(undefined);
  sw.getRegistration.mockResolvedValue({ update });
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const navigator = { serviceWorker: sw, onLine: true };
  const win = {
    document: doc, navigator,
    setInterval: window.setInterval.bind(window), clearInterval: window.clearInterval.bind(window),
  } as unknown as Window;
  return { win, sw, doc, navigator, update };
}

describe('atualização do PWA', () => {
  it('não avisa na instalação inicial nem repete a versão já vista', () => {
    expect(updates.hasNewVersion('primeira')).toBe(false);
    expect(updates.hasNewVersion('primeira')).toBe(false);
    expect(updates.hasNewVersion('segunda')).toBe(true);
    expect(localStorage.getItem(updates.SEEN_VERSION_KEY)).toBe('primeira');
  });

  it('tolera armazenamento ausente ou bloqueado', () => {
    expect(updates.hasNewVersion('nova', null)).toBe(false);
    expect(updates.hasNewVersion('nova', {
      getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); },
    })).toBe(false);
  });

  it('detecta o novo controlador e recarrega uma única vez', () => {
    const { win, sw } = serviceWorkerWindow();
    dispose = updates.initAppUpdate({ win });
    sw.dispatchEvent(new Event('controllerchange'));
    expect(updates.getAppUpdateState().reloadPending).toBe(true);
    const reload = vi.fn();
    updates.reloadForUpdate(reload);
    updates.reloadForUpdate(reload);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignora a primeira instalação, mas detecta a próxima atualização na mesma sessão', () => {
    const { win, sw } = serviceWorkerWindow(false);
    dispose = updates.initAppUpdate({ win });
    sw.controller = {};
    sw.dispatchEvent(new Event('controllerchange'));
    expect(updates.getAppUpdateState().reloadPending).toBe(false);
    sw.controller = {};
    sw.dispatchEvent(new Event('controllerchange'));
    expect(updates.getAppUpdateState().reloadPending).toBe(true);
  });

  it('busca ao voltar e de hora em hora, respeitando visibilidade, rede e intervalo mínimo', async () => {
    const { win, sw, doc, navigator, update } = serviceWorkerWindow();
    dispose = updates.initAppUpdate({ win });
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sw.getRegistration).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_MIN_GAP_MS);
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(sw.getRegistration).toHaveBeenCalledTimes(1);
    doc.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_INTERVAL_MS);
    navigator.onLine = false;
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    navigator.onLine = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('tolera falha na busca e remove os observadores ao desligar', async () => {
    const { win, sw, doc, update } = serviceWorkerWindow();
    update.mockRejectedValue(new Error('sem rede'));
    dispose = updates.initAppUpdate({ win });
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(updates.UPDATE_CHECK_INTERVAL_MS);
    doc.dispatchEvent(new Event('visibilitychange'));
    sw.dispatchEvent(new Event('controllerchange'));
    expect(update).toHaveBeenCalledTimes(1);
    expect(updates.getAppUpdateState().reloadPending).toBe(false);
  });

  it.each(['/licao/u1-l1', '/licao/u1-l1/concluida', '/camera', '/configuracoes/camera'])('não considera %s segura', path => {
    expect(updates.isSafeForUpdate(path)).toBe(false);
  });
});

function notice(path: string, busy = false) {
  return (
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Link to="/aprender">Mapa</Link>
      <Link to="/licao/u1-l1">Lição</Link>
      <Link to="/camera">Câmera</Link>
      <AppUpdateNotice busy={busy} />
    </MemoryRouter>
  );
}

describe('aviso de app atualizado', () => {
  it.each(['/licao/u1-l1', '/camera'])('espera sair de %s, aparece uma vez e some em 4 segundos', path => {
    localStorage.setItem(updates.SEEN_VERSION_KEY, 'anterior');
    dispose = updates.initAppUpdate({ win: { navigator: {} } as Window });
    render(notice(path));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(localStorage.getItem(updates.SEEN_VERSION_KEY)).toBe('anterior');
    fireEvent.click(screen.getByText('Mapa'));
    expect(screen.getByRole('status')).toHaveTextContent('App atualizado');
    expect(localStorage.getItem(updates.SEEN_VERSION_KEY)).toBe(versionId());
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    cleanup();
    updates.resetAppUpdate();
    dispose = updates.initAppUpdate({ win: { navigator: {} } as Window });
    render(notice('/aprender'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['Lição', 'Câmera'])('remove imediatamente o aviso ao entrar em %s', destination => {
    updates.resetAppUpdate({ notice: 'pending' });
    render(notice('/aprender'));
    expect(screen.getByRole('status')).toBeInTheDocument();
    fireEvent.click(screen.getByText(destination));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Mapa'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('espera outro aviso da sessão sair', () => {
    updates.resetAppUpdate({ notice: 'pending' });
    const view = render(notice('/configuracoes', true));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    view.rerender(notice('/configuracoes'));
    expect(screen.getByRole('status')).toHaveTextContent('App atualizado');
  });

  it('adia a recarga na lição, na câmera e durante outro aviso', () => {
    const reload = vi.spyOn(updates, 'reloadForUpdate').mockImplementation(() => {});
    updates.resetAppUpdate({ reloadPending: true });
    render(notice('/licao/u1-l1'));
    fireEvent.click(screen.getByText('Câmera'));
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Mapa'));
    expect(reload).toHaveBeenCalledTimes(1);
    cleanup();
    render(notice('/aprender', true));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
