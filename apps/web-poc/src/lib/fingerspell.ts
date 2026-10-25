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
 * A pausa entre letras (a classe "nenhuma letra" do modelo, ou a mão fora do quadro) chega como
 * null: não conta como letra, não volta a palavra e solta a espera da letra repetida.
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

/** Nome mais longo que vira o "soletre seu nome"; acima disso fica a palavra de reserva. */
export const OWN_NAME_MAX = 8;

/**
 * Letras do primeiro nome do perfil para o "soletre seu nome", ou null quando o nome não dá:
 * caixa alta, sem acento (Á vira A, mas Ç continua Ç) e só letras. Nome vazio, de uma letra, com
 * mais de OWN_NAME_MAX letras ou com J, Z ou Ç (letras com movimento, que a câmera não avalia)
 * dá null, e a lição usa a palavra de reserva do bundle.
 */
export function ownNameLetters(displayName: string | null | undefined): string[] | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  const word = [...first.normalize('NFC').toUpperCase()]
    .map(c => (c === 'Ç' ? c : c.normalize('NFD').replace(/\p{M}/gu, '')))
    .join('')
    .replace(/[^A-ZÇ]/g, '');
  if (word.length < 2 || word.length > OWN_NAME_MAX || /[JZÇ]/.test(word)) return null;
  return [...word];
}
