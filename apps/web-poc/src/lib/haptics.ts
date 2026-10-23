import { tokens } from '../styles/tokens';

/**
 * Háptica do Librax (seção 10 da proposta de design system).
 *
 * Regras:
 * - Vibração nunca é essencial: todo evento já tem um equivalente visual na tela.
 * - Erro nunca vibra (o padrão de `wrong` nos tokens é vazio).
 * - iPhone e iPad não têm Vibration API no navegador: lá a função simplesmente não chama nada.
 * - Os padrões (ms) vêm de docs/design-tokens.json via styles/tokens.ts.
 */

export type HapticEvent =
  | 'tap'
  | 'select'
  | 'correct'
  | 'correctCamera'
  | 'wrong'
  | 'achievement'
  | 'streak'
  | 'goalMet'
  | 'freeze'
  | 'courseDone';

/** Padrão de vibração do token haptic.<evento> (lista vazia = não vibra). */
export function hapticPattern(event: HapticEvent): readonly number[] {
  const token = tokens[`haptic.${event}`] as { web: readonly number[] } | undefined;
  return token?.web ?? [];
}

/** iOS (inclui iPadOS que se apresenta como Mac com toque). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && !isIOS();
}

/**
 * Dispara a vibração do evento, quando houver suporte.
 * `enabled` permite respeitar uma futura opção "Vibração" nas Configurações.
 */
export function haptic(event: HapticEvent, enabled = true): void {
  const pattern = hapticPattern(event);
  if (!enabled || pattern.length === 0 || !canVibrate()) return;
  try {
    navigator.vibrate([...pattern]);
  } catch {
    /* sem efeito colateral: háptica é opcional */
  }
}

/** Atalhos por evento, para manter as chamadas curtas nos componentes. */
export const Haptics = {
  tap: () => haptic('tap'),
  select: () => haptic('select'),
  correct: () => haptic('correct'),
  correctCamera: () => haptic('correctCamera'),
  /** Erro nunca vibra: existe só para deixar a regra explícita em quem chama. */
  wrong: () => haptic('wrong'),
  achievement: () => haptic('achievement'),
  streak: () => haptic('streak'),
  goalMet: () => haptic('goalMet'),
  freeze: () => haptic('freeze'),
  courseDone: () => haptic('courseDone'),
};
