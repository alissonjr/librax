import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/** Campo do state da entrada do histórico que diz qual sheet ou diálogo a criou. */
const MARK = 'lxOverlay';
let seq = 0;

function markOf(state: unknown): string | undefined {
  const mark = (state as Record<string, unknown> | null | undefined)?.[MARK];
  return typeof mark === 'string' ? mark : undefined;
}

/** state do react-router guardado no history do navegador ({ usr, key, idx }). */
function browserEntryMark(): string | undefined {
  return markOf((window.history.state as { usr?: unknown } | null)?.usr);
}

/**
 * Sheets e modais no histórico (design-system 11.13): abrir cria uma entrada com o mesmo endereço,
 * e o voltar (do navegador, do Android ou o gesto do iPhone) fecha o sheet em vez de trocar de tela.
 *
 * - Abriu (`open` verdadeiro): empilha a entrada, sem rolar a página.
 * - Voltar com ele aberto: a entrada sai do topo e `onClose` é chamado.
 * - Fechou pelo app (botão, toque fora) ou a tela saiu: tira a entrada que sobrou, para o próximo
 *   voltar não cair numa entrada vazia. Espera um instante antes de olhar, porque o mesmo toque
 *   pode ter navegado (por exemplo, "Começar nova sequência" troca de aba e já substitui a entrada).
 *
 * Não serve para o "Sair da lição?", que nasce de um voltar segurado pelo useBlocker: empilhar uma
 * entrada ali soltaria o bloqueio (ver useLessonExit).
 */
export function useCloseOnBack(open: boolean, onClose: () => void): void {
  const navigate = useNavigate();
  const location = useLocation();
  const live = useRef({ open, onClose, location, mounted: false });
  useLayoutEffect(() => {
    live.current.open = open;
    live.current.onClose = onClose;
    live.current.location = location;
  });
  // Entrada criada por este sheet; `seen` fica verdadeiro quando ela chega ao topo
  const entry = useRef<{ id: string; seen: boolean } | null>(null);

  useEffect(() => {
    live.current.mounted = true;
    return () => { live.current.mounted = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    // No StrictMode o efeito roda duas vezes: a entrada já criada vale para as duas
    if (!entry.current) {
      const id = `o${++seq}`;
      entry.current = { id, seen: false };
      const { pathname, search, hash, state } = live.current.location;
      const base = state && typeof state === 'object' ? state : {};
      navigate({ pathname, search, hash }, { state: { ...base, [MARK]: id }, preventScrollReset: true });
    }
    const mine = entry.current;
    return () => {
      window.setTimeout(() => {
        // Continua aberto (efeito refeito pelo StrictMode) ou já foi fechado pelo voltar
        if ((live.current.mounted && live.current.open) || entry.current !== mine) return;
        entry.current = null;
        if (browserEntryMark() === mine.id) window.history.back();
      }, 0);
    };
  }, [open, navigate]);

  useEffect(() => {
    const mine = entry.current;
    if (!mine) return;
    if (markOf(location.state) === mine.id) {
      mine.seen = true;
    } else if (mine.seen) {
      // A entrada saiu do topo com o sheet aberto: foi o voltar
      entry.current = null;
      live.current.onClose();
    }
  }, [location]);
}
