/**
 * Quando pedir a nota do app (FeedbackSheet), com o estado guardado no aparelho.
 *
 * - Primeira vez: assim que a pessoa tiver uma lição concluída. Quem concluiu a primeira agora vê
 *   ao voltar ao mapa; quem já tinha lições antes desta versão vê no mapa, na próxima abertura ou
 *   depois da próxima lição. Nunca no meio de um exercício nem por cima da câmera (só no mapa).
 * - "Agora não": pergunta de novo depois de mais 3 lições concluídas, no máximo mais 2 vezes.
 * - Depois de mandar a nota, nunca mais.
 */

const KEY = 'librax_feedbackPrompt';

/** Lições a mais antes de perguntar de novo, e quantas vezes a pessoa pode dizer "Agora não". */
export const ASK_AGAIN_AFTER_LESSONS = 3;
export const MAX_DISMISSALS = 3;

export interface FeedbackPromptState {
  answered: boolean;
  dismissals: number;
  /** Lições concluídas a partir das quais pode perguntar de novo (null: ainda não perguntou). */
  nextAt: number | null;
}

const EMPTY: FeedbackPromptState = { answered: false, dismissals: 0, nextAt: null };

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadFeedbackPrompt(storage: Pick<Storage, 'getItem'> | null = safeStorage()): FeedbackPromptState {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const s = JSON.parse(raw) as Partial<FeedbackPromptState>;
    return {
      answered: s.answered === true,
      dismissals: Number.isInteger(s.dismissals) ? Math.max(0, s.dismissals as number) : 0,
      nextAt: Number.isInteger(s.nextAt) ? (s.nextAt as number) : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

function save(state: FeedbackPromptState): FeedbackPromptState {
  try {
    safeStorage()?.setItem(KEY, JSON.stringify(state));
  } catch {
    /* sem armazenamento: pode perguntar de novo na próxima visita */
  }
  return state;
}

/** Está na hora de perguntar? `lessonsCompleted` conta as lições concluídas no aparelho. */
export function shouldAskFeedback(state: FeedbackPromptState, lessonsCompleted: number): boolean {
  if (state.answered || state.dismissals >= MAX_DISMISSALS) return false;
  if (lessonsCompleted < 1) return false;
  return state.dismissals === 0 || lessonsCompleted >= (state.nextAt ?? 0);
}

/** "Agora não" (ou fechar): pergunta de novo depois de mais 3 lições. */
export function dismissFeedbackPrompt(lessonsCompleted: number, state = loadFeedbackPrompt()): FeedbackPromptState {
  return save({ answered: false, dismissals: state.dismissals + 1, nextAt: lessonsCompleted + ASK_AGAIN_AFTER_LESSONS });
}

/** Nota enviada: nunca mais pergunta. */
export function markFeedbackAnswered(state = loadFeedbackPrompt()): FeedbackPromptState {
  return save({ ...state, answered: true });
}
