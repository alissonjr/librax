import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isOverlayEntry } from './useCloseOnBack';

/** Espera máxima pela saída da entrada do sheet. */
const FALLBACK_MS = 300;

/**
 * Navegar a partir de um sheet que acabou de fechar. O sheet aberto ocupa uma entrada do histórico
 * (useCloseOnBack); navegar com ela ainda no topo deixaria uma entrada vazia ou faria o "voltar
 * para" errar a tela anterior. `after(fn)` roda `fn` assim que a entrada do sheet sai do topo
 * (ou na hora, se ela não existe). Quem chama fecha o sheet no mesmo toque.
 */
export function useAfterSheet(): (fn: () => void) => void {
  const location = useLocation();
  const [pending, setPending] = useState(0);
  const action = useRef<(() => void) | null>(null);

  useEffect(() => {
    const fn = action.current;
    if (!fn) return;
    const run = () => {
      if (action.current !== fn) return;
      action.current = null;
      fn();
    };
    if (!isOverlayEntry(location.state)) {
      run();
      return;
    }
    // A entrada não saiu (histórico fora do navegador, como o roteador de memória): segue assim mesmo
    const timer = window.setTimeout(run, FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [location, pending]);

  return useCallback((fn: () => void) => {
    action.current = fn;
    setPending(n => n + 1);
  }, []);
}
