/**
 * Soletração letra a letra pela câmera (spec-03 5.4 e 11.8).
 *
 * Cada passo da palavra tem quem o lê (SpellReader): as letras paradas, o classificador das letras;
 * H, J, K, X e Ç, o reconhecedor das letras com movimento (janelas de movimento, a letra vale com
 * duas avaliações seguidas iguais); os dígitos, o modelo dos números. O passo sem câmera (o Z hoje,
 * os dígitos fora de camera_numbers) é prática livre dentro da palavra: a pessoa faz o sinal e toca
 * em "Fiz" (confirmFreeStep), sem nota e sem avanço automático por tempo.
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

/**
 * Quem lê cada passo da soletração: 'letras' (classificador das letras paradas), 'letras-mov'
 * (reconhecedor das letras com movimento), 'numeros' (modelo dos números) ou 'livre' (prática livre
 * dentro da palavra: sem câmera avaliada para o passo, a pessoa confirma que fez).
 */
export type SpellReader = 'letras' | 'letras-mov' | 'numeros' | 'livre';

/** Leituras da câmera neste instante, uma por tipo de leitor. */
export interface SpellReadings {
  /** Leitura estável do classificador da mão parada (letras ou números), ou null. */
  still: string | null;
  /** Letra com movimento confirmada (duas avaliações seguidas iguais), ou null. */
  motion: string | null;
}

/** O leitor do passo da vez (null com a palavra completa). Sem a lista, tudo é 'letras'. */
export function currentReader(readers: readonly SpellReader[] | undefined, state: SpellState, length: number): SpellReader | null {
  if (state.index >= length) return null;
  return readers?.[state.index] ?? 'letras';
}

/**
 * A leitura que vale para o passo da vez: a do leitor dele; no passo livre, nenhuma (null). Trocar
 * de leitor no meio da palavra não atrapalha a regra da letra repetida: a leitura do outro leitor
 * não é a letra anterior (ou é null), então a espera se solta como numa pausa.
 */
export function spellGesture(
  readers: readonly SpellReader[] | undefined, state: SpellState, length: number, readings: SpellReadings,
): string | null {
  const reader = currentReader(readers, state, length);
  if (reader === 'letras-mov') return readings.motion;
  if (reader === 'letras' || reader === 'numeros') return readings.still;
  return null;
}

/**
 * Avança a soletração com as leituras da câmera: o spellStep com a leitura do leitor da vez.
 * Passo livre não avança pela câmera, só pelo confirmFreeStep.
 */
export function spellAdvance(
  letters: readonly string[],
  readers: readonly SpellReader[] | undefined,
  state: SpellState,
  readings: SpellReadings,
  confidence = 1,
  minConfidence: number | null = null,
): SpellState {
  if (currentReader(readers, state, letters.length) === 'livre') return state;
  return spellStep(letters, state, spellGesture(readers, state, letters.length, readings), confidence, minConfidence);
}

/** A pessoa tocou em "Fiz" no passo livre: avança sem nota e sem esperar a mão sair. */
export function confirmFreeStep(letters: readonly string[], readers: readonly SpellReader[] | undefined, state: SpellState): SpellState {
  if (currentReader(readers, state, letters.length) !== 'livre') return state;
  return { index: state.index + 1, waitingRelease: false };
}

/** Nome mais longo que vira o "soletre seu nome"; acima disso fica a palavra de reserva. */
export const OWN_NAME_MAX = 8;

/**
 * Letras do primeiro nome do perfil para o "soletre seu nome", ou null quando o nome não dá:
 * caixa alta, sem acento (Á vira A, mas Ç continua Ç) e só letras. Nome vazio, de uma letra ou com
 * mais de OWN_NAME_MAX letras dá null, e a lição usa a palavra de reserva do bundle. J, Ç e as
 * outras letras com movimento entram: cada letra tem o seu leitor (resolveExercises) e a que não
 * tem câmera (o Z hoje) é prática livre dentro do nome.
 */
export function ownNameLetters(displayName: string | null | undefined): string[] | null {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  const word = [...first.normalize('NFC').toUpperCase()]
    .map(c => (c === 'Ç' ? c : c.normalize('NFD').replace(/\p{M}/gu, '')))
    .join('')
    .replace(/[^A-ZÇ]/g, '');
  if (word.length < 2 || word.length > OWN_NAME_MAX) return null;
  return [...word];
}
