import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useBlocker, type BlockerFunction } from 'react-router-dom';

export interface LessonExit {
  /** O diálogo "Sair da lição?" está aberto (uma saída foi segurada). */
  asking: boolean;
  /** Sair: segue a navegação que foi segurada. */
  confirm: () => void;
  /** Continuar: fica na lição. */
  cancel: () => void;
  /** Lição concluída: libera a saída para a tela de conclusão. */
  finish: () => void;
}

/**
 * "Sair da lição?" (design-system 11.13): qualquer saída da lição (voltar do Android, do navegador,
 * botão do topo, link) para no diálogo enquanto `active` for verdadeiro.
 *
 * Fica na rota da lição, montada desde o carregamento, e não na tela da lição: o useBlocker só
 * passa a valer dois renders depois de montar, então, montado junto com a lição, um voltar logo
 * que ela aparecia saía sem o diálogo. Aqui ele já está registrado quando a lição aparece, e
 * `active` (lido na hora da navegação) evita segurar a saída durante o carregamento.
 *
 * Com o diálogo aberto, um novo voltar fecha o diálogo e fica na lição, como nos sheets.
 */
export function useLessonExit(active: boolean): LessonExit {
  const activeRef = useRef(false);
  const finished = useRef(false);
  useLayoutEffect(() => {
    activeRef.current = active;
  }, [active]);

  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) =>
    activeRef.current && !finished.current && currentLocation.pathname !== nextLocation.pathname,
  []);
  const blocker = useBlocker(shouldBlock);

  // Cada saída segurada gera um novo objeto "blocked": se chega outro com o diálogo já aberto,
  // foi um segundo voltar, que fecha o diálogo.
  const last = useRef(blocker);
  useEffect(() => {
    const prev = last.current;
    last.current = blocker;
    if (blocker.state === 'blocked' && prev.state === 'blocked' && prev !== blocker) blocker.reset();
  }, [blocker]);

  return {
    asking: blocker.state === 'blocked',
    confirm: () => blocker.proceed?.(),
    cancel: () => blocker.reset?.(),
    finish: () => { finished.current = true; },
  };
}
