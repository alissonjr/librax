/*
 * Dica de erro da câmera: o par "pedido>lido" no dicas-erro.json (gerado por
 * scripts/gerar-dicas-erro.ts) vira a frase da dica, no vocabulário de i18n wrongHint.*. Leve (sem
 * three.js): entra no código da lição, também sem WebGL (dica só em texto).
 */
import dados from './dicas-erro.json';
import type { TFunc } from '../i18n';
import type { HintItem, PairDiff } from './diferenca';
import type { Digit, LongFinger } from './forma';

const dicas = dados.dicas as unknown as Record<string, PairDiff>;

/** A diferença precalculada entre o sinal pedido e o lido, ou null se o par não está nos dados. */
export function pairHint(asked: string, read: string): PairDiff | null {
  return dicas[`${asked}>${read}`] ?? null;
}

/** Pares com dica (para os testes). */
export function hintPairs(): string[] {
  return Object.keys(dicas);
}

export type SignKind = 'letter' | 'number';

function what(t: TFunc, gloss: string, kind: SignKind): string {
  return t(kind === 'number' ? 'wrongHint.number' : 'wrongHint.letter', { g: gloss });
}

const finger = (t: TFunc, d: Digit) => t(`wrongHint.finger.${d}`);

function list(t: TFunc, fingers: readonly LongFinger[]): string {
  if (fingers.length >= 4) return t('wrongHint.allFingers');
  const names = fingers.map((f) => finger(t, f));
  if (names.length === 3) return t('wrongHint.list3', { a: names[0], b: names[1], c: names[2] });
  if (names.length === 2) return t('wrongHint.list2', { a: names[0], b: names[1] });
  return names[0] ?? '';
}

/** Uma parte da dica, em palavras ("o polegar fica dobrado junto da palma"). */
export function itemText(t: TFunc, item: HintItem, asked: string, kind: SignKind): string {
  switch (item.k) {
    case 'dedo':
      return t('wrongHint.one', { finger: finger(t, item.d), state: t(`wrongHint.state.${item.v}`) });
    case 'dedos':
      return t('wrongHint.many', { fingers: list(t, item.d), state: t(`wrongHint.statePlural.${item.v}`) });
    case 'abertura':
      return t(`wrongHint.gap.${item.v}`, { fingers: list(t, item.d) });
    case 'cruzados':
      return t(`wrongHint.cross.${item.v}`);
    case 'polegar':
      return t(`wrongHint.thumb.${item.v}`, item.d ? { of: t(`wrongHint.fingerOf.${item.d}`), on: t(`wrongHint.fingerOn.${item.d}`) } : undefined);
    case 'direcao':
      return t(`wrongHint.direction.${item.v}`);
    case 'movimento':
      return t(`wrongHint.move.${item.v}`, { what: what(t, asked, kind) });
  }
}

export interface HintTexts {
  /** "Diferença: o polegar fica dobrado junto da palma" (ou "Compare as duas mãos" sem dados). */
  line: string;
  /** Para o leitor de tela: "A câmera viu H. Você precisa fazer K: o K tem outro movimento." */
  spoken: string;
  /** A diferença é o movimento (a mão do sinal com movimento toca). */
  movement: boolean;
}

export function hintTexts(t: TFunc, asked: string, read: string, kind: SignKind, diff: PairDiff | null = pairHint(asked, read)): HintTexts {
  const parts = (diff?.i ?? []).map((item) => itemText(t, item, asked, kind));
  const joined = parts.length === 2 ? t('wrongHint.and', { a: parts[0], b: parts[1] }) : parts[0] ?? '';
  const askedWhat = what(t, asked, kind);
  const readWhat = what(t, read, kind);
  return {
    line: joined ? t('wrongHint.difference', { text: joined }) : t('wrongHint.compare'),
    spoken: joined
      ? t('wrongHint.spoken', { read: readWhat, asked: askedWhat, text: joined })
      : t('wrongHint.spokenNoDiff', { read: readWhat, asked: askedWhat }),
    movement: !!diff?.i.some((item) => item.k === 'movimento'),
  };
}
