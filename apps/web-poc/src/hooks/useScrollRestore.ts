import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Posição de rolagem por entrada do histórico (location.key). Fica também no sessionStorage para
 * valer depois de recarregar a página (por exemplo, recarregar numa lição e voltar ao mapa).
 */
const STORAGE_KEY = 'librax_scrollPositions';
const MAX_ENTRIES = 50;

let positions: Map<string, number> | null = null;

function load(): Map<string, number> {
  if (positions) return positions;
  positions = new Map();
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (Array.isArray(item) && typeof item[0] === 'string' && typeof item[1] === 'number') {
          positions.set(item[0], item[1]);
        }
      }
    }
  } catch {
    /* sessionStorage indisponível: fica só na memória */
  }
  return positions;
}

function save(key: string, y: number): void {
  const map = load();
  map.delete(key);
  map.set(key, y);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...map]));
  } catch {
    /* sessionStorage indisponível: fica só na memória */
  }
}

/** Entrada atual do histórico do navegador (o react-router guarda a key em history.state). */
function browserEntryKey(): string | undefined {
  const key = (window.history.state as { key?: unknown } | null)?.key;
  return typeof key === 'string' ? key : undefined;
}

/**
 * Restaura a rolagem de uma tela que carrega os dados depois de aparecer (design-system 11.13: ao
 * voltar, a posição anterior é restaurada). O ScrollRestoration do roteador rola logo que a rota
 * monta, quando a tela ainda é só o skeleton e a página é curta demais. Aqui a posição é guardada
 * enquanto a pessoa rola e restaurada ao voltar (POP) só quando `ready` indica que o conteúdo
 * já está na tela.
 */
export function useScrollRestore(ready: boolean): void {
  const { key } = useLocation();
  const navigationType = useNavigationType();
  const handled = useRef<string | null>(null);

  // Antes de pintar, para não aparecer no topo e pular
  useLayoutEffect(() => {
    if (!ready || handled.current === key) return;
    handled.current = key;
    if (navigationType !== 'POP') return;
    const y = load().get(key);
    if (y !== undefined) window.scrollTo(0, y);
  }, [ready, key, navigationType]);

  // Só guarda depois de restaurar: antes disso a página curta prenderia a rolagem no topo
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        // A tela nova pode já ter rolado para o topo antes de esta desmontar
        const current = browserEntryKey();
        if (current !== undefined && current !== key) return;
        save(key, window.scrollY);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [ready, key]);
}
