/**
 * Modo livre da câmera: a pessoa soletra o que quiser e o texto vai se formando, como um ditado.
 * Função pura (freeStep) que recebe a leitura de cada quadro e devolve o novo estado; a câmera
 * (useFreeModeCamera) só junta as leituras e chama. Nada daqui vai para o progresso das lições.
 *
 * Uma família de reconhecedor por vez (modo Letras ou Números), para o O não virar 0 nem o S
 * virar 8. Nas letras, duas leituras chegam juntas e são arbitradas:
 * - a das letras paradas (classificador estático): vale quando a mesma letra fica STATIC_HOLD_MS
 *   na tela com a mão parada (sem movimento na janela curta do reconhecedor de movimento);
 * - a das letras com movimento (H, J, K, X e Ç, com modelo e regras por letra): vale quando o
 *   reconhecedor confirma (duas avaliações seguidas, no hook). Essas letras só entram pelo
 *   movimento: a forma parada do H, do K ou do X lida pelo estático não escreve nada (vira dica).
 *   Se o movimento confirma logo depois de uma letra parada (até REPLACE_MS, sem espaço no meio),
 *   a letra parada era o começo do movimento (o I do J, o C do Ç) e é trocada pela com movimento.
 *
 * Regra de soltar (a mesma da soletração das lições, lib/fingerspell.ts): depois de uma letra
 * parada, a mesma letra só vale de novo depois de a leitura mudar ou sumir (OSSO pede soltar entre
 * os dois S); uma letra diferente vale direto. Depois de uma letra com movimento, a próxima letra
 * parada espera uma pausa (leitura "nenhuma letra" ou mão fora), para a forma em que o movimento
 * termina (o I no fim do J) não virar outra letra.
 *
 * Espaço: a mão fora do quadro (ou abaixada) por SPACE_MS põe um espaço, uma vez por saída.
 * Dica: mão no quadro por HINT_MS sem nenhuma letra entrar mostra uma dica gentil; nunca pune.
 */

export type FreeMode = 'letras' | 'numeros';

/** Leitura de um quadro. Tempo em ms. */
export interface FreeTick {
  t: number;
  handPresent: boolean;
  /** Letra (ou número) do classificador parado, ou null ("nenhuma letra" ou abaixo do limiar). */
  staticLetter: string | null;
  staticConfidence: number;
  /** Letra com movimento confirmada pelo reconhecedor (duas avaliações seguidas), ou null. */
  motionLetter: string | null;
  /** A mão está se mexendo (janela curta do reconhecedor de movimento passa do portão). */
  moving: boolean;
}

/** O que cada modo aceita agora (depende dos modelos que carregaram). */
export interface FreeConfig {
  /** Aceitas pela leitura parada. */
  staticLetters: ReadonlySet<string>;
  /** Só pelo movimento (com o modelo das letras com movimento carregado; vazio sem ele). */
  motionLetters: ReadonlySet<string>;
}

export type FreeHint = 'hold' | 'motion' | 'release';

export type FreeEventKind = 'add' | 'replace' | 'space';

export interface FreeEvent {
  kind: FreeEventKind;
  char: string;
  /** Sobe a cada evento: chave para o anúncio e a animação. */
  seq: number;
}

export interface FreeState {
  text: string;
  /** Leitura que está sendo mostrada agora (o que a câmera vê), ou null. */
  current: { letter: string; confidence: number; motion: boolean } | null;
  hint: FreeHint | null;
  /** A letra que a dica 'motion' cita. */
  hintLetter: string | null;
  lastEvent: FreeEvent | null;
  /* ---- interno ---- */
  candidate: { letter: string; since: number } | null;
  /** 'letter': a mesma letra parada espera soltar; 'pause': qualquer letra parada espera uma pausa. */
  release: { kind: 'letter'; letter: string } | { kind: 'pause' } | null;
  /** Desde quando a condição que solta a espera vale (ela precisa durar RELEASE_MS). */
  releaseSince: number | null;
  /** Letra com movimento já escrita enquanto o reconhecedor ainda a confirma. */
  motionHeld: string | null;
  lastCommit: { letter: string; at: number; source: 'static' | 'motion' } | null;
  noHandSince: number | null;
  /** Já pôs o espaço desta saída da mão. */
  spaced: boolean;
  /** Desde quando a mão está no quadro sem nenhuma letra entrar. */
  idleSince: number | null;
}

/** Letra parada precisa ficar este tempo na tela (um pouco mais que nas lições: aqui não há alvo). */
export const STATIC_HOLD_MS = 600;
/** Mão fora do quadro por este tempo vira espaço. */
export const SPACE_MS = 1200;
/** Movimento confirmado até este tempo depois de uma letra parada troca a letra parada. */
export const REPLACE_MS = 1600;
/** A leitura que solta a espera (outra letra, nenhuma, mão fora) precisa durar isto: um quadro perdido não solta. */
export const RELEASE_MS = 300;
/**
 * Outra confirmação de letra com movimento antes disto, sem nada escrito no meio, é o mesmo
 * movimento (as janelas do reconhecedor ainda o contêm: LETTER_BUFFER_S).
 */
export const MOTION_REPEAT_MS = 2000;
/** Mão no quadro por este tempo sem nenhuma letra entrar mostra a dica. */
export const HINT_MS = 4000;
/** Teto do texto (o resto é ignorado até apagar). */
export const MAX_TEXT = 300;

export const FREE_START: FreeState = {
  text: '',
  current: null,
  hint: null,
  hintLetter: null,
  lastEvent: null,
  candidate: null,
  release: null,
  releaseSince: null,
  motionHeld: null,
  lastCommit: null,
  noHandSince: null,
  spaced: false,
  idleSince: null,
};

function chars(text: string): string[] {
  return [...text];
}

function nextEvent(state: FreeState, kind: FreeEventKind, char: string): FreeEvent {
  return { kind, char, seq: (state.lastEvent?.seq ?? 0) + 1 };
}

function append(state: FreeState, char: string): string | null {
  if (chars(state.text).length >= MAX_TEXT) return null;
  return state.text + char;
}

/** Atualiza a espera de soltar: a condição que solta precisa durar RELEASE_MS (um quadro sem mão não solta). */
function settleRelease(
  state: FreeState, t: number, releasing: boolean,
): Pick<FreeState, 'release' | 'releaseSince'> {
  if (state.release === null || !releasing) return { release: state.release, releaseSince: null };
  const since = state.releaseSince ?? t;
  return t - since >= RELEASE_MS ? { release: null, releaseSince: null } : { release: state.release, releaseSince: since };
}

/** Avança o modo livre com a leitura de um quadro. */
export function freeStep(state: FreeState, tick: FreeTick, config: FreeConfig): FreeState {
  const { t } = tick;

  // Mão fora: some a leitura e a dica; passado RELEASE_MS solta a espera e, passado SPACE_MS,
  // entra um espaço (uma vez por saída)
  if (!tick.handPresent) {
    const noHandSince = state.noHandSince ?? t;
    const absentFor = t - noHandSince;
    let next: FreeState = {
      ...state,
      ...settleRelease(state, t, true),
      current: null, hint: null, hintLetter: null, candidate: null, idleSince: null, noHandSince,
      motionHeld: absentFor >= RELEASE_MS ? null : state.motionHeld,
    };
    if (!state.spaced && absentFor >= SPACE_MS) {
      next = { ...next, spaced: true };
      const text = state.text && !state.text.endsWith(' ') ? append(state, ' ') : null;
      if (text !== null) next = { ...next, text, lastEvent: nextEvent(state, 'space', ' '), lastCommit: null };
    }
    return next;
  }

  const base: FreeState = { ...state, noHandSince: null, spaced: false, idleSince: state.idleSince ?? t };

  // 1. Letra com movimento confirmada (só as do modelo de movimento). A mesma confirmação seguida
  // não escreve de novo; outra confirmação logo depois, sem nada escrito no meio, é o mesmo movimento.
  const motion = tick.motionLetter !== null && config.motionLetters.has(tick.motionLetter) ? tick.motionLetter : null;
  const last = state.lastCommit;
  const sameMovement = last !== null && last.source === 'motion' && t - last.at < MOTION_REPEAT_MS;
  if (motion !== null && motion !== state.motionHeld && !sameMovement) {
    const replace = last !== null && last.source === 'static' && t - last.at <= REPLACE_MS
      && state.text.endsWith(last.letter);
    let text: string | null;
    if (replace) {
      const cs = chars(state.text);
      cs.pop();
      text = cs.join('') + motion;
    } else {
      text = append(state, motion);
    }
    if (text === null) return { ...base, motionHeld: motion };
    return {
      ...base,
      text,
      current: { letter: motion, confidence: 1, motion: true },
      hint: null,
      hintLetter: null,
      lastEvent: nextEvent(state, replace ? 'replace' : 'add', motion),
      candidate: null,
      release: { kind: 'pause' },
      releaseSince: null,
      motionHeld: motion,
      lastCommit: { letter: motion, at: t, source: 'motion' },
      idleSince: t,
    };
  }
  const motionHeld = motion ?? (state.motionHeld !== null && sameMovement ? state.motionHeld : null);

  // 2. Letra parada
  const raw = tick.staticLetter;
  // A forma parada de uma letra com movimento não escreve: vira dica
  const motionShape = raw !== null && config.motionLetters.has(raw) ? raw : null;
  const letter = raw !== null && motionShape === null && config.staticLetters.has(raw) ? raw : null;

  const releasing = state.release?.kind === 'letter' ? letter !== state.release.letter : raw === null;
  const { release, releaseSince } = settleRelease(state, t, releasing);

  const current = raw !== null ? { letter: raw, confidence: tick.staticConfidence, motion: false } : null;

  let candidate = state.candidate;
  if (letter === null || tick.moving) candidate = null;
  else if (candidate?.letter !== letter) candidate = { letter, since: t };

  // A mesma letra que acabou de entrar espera soltar; outra letra vale direto
  const blocked = release !== null && (release.kind === 'pause' || release.letter === candidate?.letter);
  if (candidate !== null && !blocked && t - candidate.since >= STATIC_HOLD_MS) {
    const text = append(state, candidate.letter);
    if (text !== null) {
      return {
        ...base,
        text,
        current,
        hint: null,
        hintLetter: null,
        lastEvent: nextEvent(state, 'add', candidate.letter),
        candidate: null,
        release: { kind: 'letter', letter: candidate.letter },
        releaseSince: null,
        motionHeld,
        lastCommit: { letter: candidate.letter, at: t, source: 'static' },
        idleSince: t,
      };
    }
  }

  // 3. Dica depois de um tempo sem nenhuma letra entrar
  let hint: FreeHint | null = null;
  let hintLetter: string | null = null;
  if (t - base.idleSince! >= HINT_MS) {
    if (motionShape !== null) {
      hint = 'motion';
      hintLetter = motionShape;
    } else if (blocked && raw !== null) {
      hint = 'release';
    } else {
      hint = 'hold';
    }
  }

  return { ...base, current, hint, hintLetter, candidate, release, releaseSince, motionHeld };
}

/**
 * Troca de modo (Letras e Números) ou câmera religada: o texto fica, a leitura recomeça.
 */
export function freeResetReading(state: FreeState): FreeState {
  return {
    ...FREE_START,
    text: state.text,
    lastEvent: state.lastEvent,
  };
}

/** Apaga o último caractere. A espera de soltar continua: a letra ainda na mão não volta sozinha. */
export function freeDeleteLast(state: FreeState): FreeState {
  if (!state.text) return state;
  const cs = chars(state.text);
  cs.pop();
  return { ...state, text: cs.join(''), lastCommit: null, idleSince: null };
}

/** Limpa o texto todo. */
export function freeClear(state: FreeState): FreeState {
  if (!state.text) return state;
  return { ...state, text: '', lastCommit: null, idleSince: null };
}

/** Espaço pelo botão (o mesmo do gesto): nunca no começo nem dois seguidos. */
export function freeAddSpace(state: FreeState): FreeState {
  if (!state.text || state.text.endsWith(' ')) return state;
  const text = append(state, ' ');
  if (text === null) return state;
  return { ...state, text, lastEvent: nextEvent(state, 'space', ' '), lastCommit: null };
}
