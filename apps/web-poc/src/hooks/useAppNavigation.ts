import { useCallback, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ROUTES } from '../lib/routes';

/**
 * Caminho de cada entrada do histórico desta aba, por índice (o react-router guarda o índice em
 * history.state.idx). Serve para "voltar para X" sem empilhar telas repetidas: se a entrada
 * anterior já é X, volta de fato (e a rolagem do mapa é restaurada); senão, troca a atual por X.
 * Fica no sessionStorage para sobreviver a recarregar a página.
 */
const STORAGE_KEY = 'librax_historyPaths';

function readPaths(): string[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

function writePaths(paths: string[]): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  } catch {
    /* sessionStorage indisponível: "voltar para" cai na troca da entrada atual */
  }
}

function historyIndex(): number {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : 0;
}

/** Registra o caminho de cada entrada do histórico. Montado uma vez no layout raiz. */
export function HistoryTracker() {
  const location = useLocation();
  useEffect(() => {
    const idx = historyIndex();
    const paths = readPaths().slice(0, idx);
    paths[idx] = location.pathname;
    writePaths(paths);
  }, [location]);
  return null;
}

export interface AppNavigation {
  /** Volta uma tela; se a tela atual foi a primeira desta aba (link direto, recarga), vai para `fallback`. */
  back: (fallback: string) => void;
  /** Vai para `path` voltando no histórico quando a entrada anterior já é ela. */
  backTo: (path: string) => void;
  /**
   * Troca de aba. Aprender é a aba inicial: das outras abas o voltar do Android leva a ela, e dela
   * sai do app. Por isso trocar entre abas que não são Aprender substitui a entrada atual.
   */
  goTab: (path: string) => void;
}

export function useAppNavigation(): AppNavigation {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const back = useCallback((fallback: string) => {
    if (historyIndex() > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  }, [navigate]);

  const backTo = useCallback((path: string) => {
    const idx = historyIndex();
    if (idx > 0 && readPaths()[idx - 1] === path) navigate(-1);
    else navigate(path, { replace: true });
  }, [navigate]);

  const goTab = useCallback((path: string) => {
    if (path === pathname) return;
    if (path === ROUTES.learn) backTo(ROUTES.learn);
    else if (pathname === ROUTES.learn) navigate(path);
    else navigate(path, { replace: true });
  }, [pathname, navigate, backTo]);

  return useMemo(() => ({ back, backTo, goTab }), [back, backTo, goTab]);
}
