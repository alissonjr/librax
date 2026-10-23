/**
 * Soletração letra a letra pela câmera (spec-03 5.4 e 11.8).
 *
 * `index` é a letra da vez. Depois de confirmar uma letra, `waitingRelease` fica ligado até a
 * leitura estável deixar de ser essa letra (a mão saiu do quadro ou mudou de forma). Assim a
 * mesma letra seguida (o SS de OSSO) precisa ser feita duas vezes, e uma letra diferente da
 * anterior é aceita direto.
 */
export interface SpellState {
  index: number;
  waitingRelease: boolean;
}

export const SPELL_START: SpellState = { index: 0, waitingRelease: false };

/**
 * Avança a soletração com a leitura estável da câmera (`gesture`: letra confirmada pelo
 * reconhecedor, ou null sem mão ou sem letra). `minConfidence` null = padrão do reconhecedor.
 * Função pura: devolve o mesmo objeto quando nada muda.
 */
export function spellStep(
  letters: readonly string[],
  state: SpellState,
  gesture: string | null,
  confidence = 1,
  minConfidence: number | null = null,
): SpellState {
  if (state.index >= letters.length) return state;
  const previous = state.index > 0 ? letters[state.index - 1] : null;
  // Continua esperando só enquanto a leitura for a letra que acabou de ser confirmada
  const waitingRelease = state.waitingRelease && gesture === previous;
  const passes = minConfidence === null || confidence >= minConfidence;

  if (!waitingRelease && gesture !== null && gesture === letters[state.index] && passes) {
    return { index: state.index + 1, waitingRelease: true };
  }
  return waitingRelease === state.waitingRelease ? state : { index: state.index, waitingRelease };
}

/** A letra da vez é igual à anterior e a mão ainda não saiu nem mudou de forma. */
export function needsRelease(letters: readonly string[], state: SpellState): boolean {
  return state.waitingRelease && state.index > 0 && state.index < letters.length
    && letters[state.index] === letters[state.index - 1];
}
