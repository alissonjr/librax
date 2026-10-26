/*
 * Diferença entre o sinal pedido e o sinal que a câmera leu, a partir da forma média das mãos da
 * mão em 3D (forma.ts). Roda no script que gera as dicas (scripts/gerar-dicas-erro.ts); o app só lê
 * o resultado (dicas-erro.json).
 *
 * Para cada dedo sai uma nota: a diferença dividida pelo limiar do tipo de diferença mais a
 * variação entre as pessoas (o que muda de uma pessoa para outra não é diferença do sinal). Entram
 * os itens com nota 1 ou mais, no máximo dois (o segundo só se tiver ao menos 60% da nota do
 * primeiro), e cada item vira palavras de um vocabulário pequeno (i18n wrongHint.*): o estado do
 * dedo no sinal pedido (esticado, curvado, dobrado), dedos juntos ou separados, cruzados, onde fica
 * o polegar, para onde a mão aponta e, nas letras com movimento, o movimento.
 */
import { LONG_FINGERS, type Digit, type LongFinger, type Shape, type SignShape } from './forma';

export type FingerState = 'esticado' | 'curvado' | 'dobrado';
/** O estado do dedo no sinal pedido ou, se é o mesmo nos dois, para que lado ele muda. */
export type FingerChange = FingerState | 'maisDobrado' | 'maisEsticado';
export type ThumbState =
  | 'tocaPontas' | 'tocaPonta' | 'encosta' | 'aoLado' | 'porCima' | 'porBaixo' | 'lado' | 'frente' | 'dobrado';
export type Direction = 'cima' | 'baixo' | 'lado' | 'frente';
export type MovementDiff = 'pedidoMove' | 'pedidoParado' | 'outroMovimento';

export type HintItem =
  | { k: 'dedo'; d: LongFinger; v: FingerChange }
  | { k: 'dedos'; d: LongFinger[]; v: FingerChange }
  | { k: 'polegar'; v: ThumbState; d?: LongFinger }
  | { k: 'abertura'; d: [LongFinger, LongFinger]; v: 'juntos' | 'separados' }
  | { k: 'cruzados'; v: 'cruzados' | 'ladoALado' }
  | { k: 'direcao'; v: Direction }
  | { k: 'movimento'; v: MovementDiff };

/** O que vai para o JSON: dedos a destacar (d) e itens da dica (i). */
export interface PairDiff {
  d: Digit[];
  i: HintItem[];
}

/** Limiares (radianos ou palmas) de cada tipo de diferença. */
export const LIMIAR = {
  /** Soma |MCP| + |PIP| + |DIP|/2. */
  dobra: 0.9,
  abertura: 0.15,
  cruzados: 0.4,
  /** Distância da ponta do polegar (palmas). */
  polegar: 0.3,
  /** Ângulo entre as direções da mão. */
  direcao: 0.9,
} as const;
/** O segundo item só entra com ao menos esta fração da nota do primeiro. */
export const SEGUNDO = 0.6;
/** Grupo de dedos: cada um com nota mínima, a média mínima e o peso do grupo na nota. */
export const GRUPO = { minimo: 0.6, media: 0.7, peso: 1.4 } as const;

const sumFlex = (f: readonly number[]) => f[0] + f[1] + f[2];
const weighted = (f: readonly number[]) => Math.abs(f[0]) + Math.abs(f[1]) + 0.5 * Math.abs(f[2]);

export function fingerState(flex: readonly number[]): FingerState {
  const s = sumFlex(flex);
  if (s < 0.9) return 'esticado';
  if (flex[0] > 1.1 && s > 3.4) return 'dobrado';
  return 'curvado';
}

/** Onde fica o polegar (o que a mão em 3D mostra). */
export function thumbState(s: Shape): { v: ThumbState; d?: LongFinger } {
  const tips = s.thumbTipTouch;
  if (tips.filter((d) => d < 0.35).length >= 2) return { v: 'tocaPontas' };
  const nearestTip = tips.indexOf(Math.min(...tips));
  if (tips[nearestTip] < 0.3) return { v: 'tocaPonta', d: LONG_FINGERS[nearestTip] };
  const m = s.thumbTouch.indexOf(Math.min(...s.thumbTouch));
  if (s.thumbTouch[m] < 0.26) {
    const finger = LONG_FINGERS[m];
    if (sumFlex(s.flex[m]) < 2.5) return { v: 'encosta', d: finger };
    if (finger === 'index' && s.thumbTip[0] > 0.12) return { v: 'aoLado' };
    return { v: s.thumbOverFingers >= 0 ? 'porCima' : 'porBaixo' };
  }
  if (s.thumbTip[0] > 0.5) return { v: 'lado' };
  if (s.thumbFront > 0.6) return { v: 'frente' };
  return { v: 'dobrado' };
}

export function direction(point: readonly number[]): Direction {
  if (point[1] > 0.6) return 'cima';
  if (point[1] < -0.6) return 'baixo';
  if (point[2] > 0.6) return 'frente';
  return 'lado';
}

interface Scored {
  item: HintItem;
  score: number;
}

const angle = (a: readonly number[], b: readonly number[]) =>
  Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

/** Diferenças de forma (sem o movimento), com a nota de cada uma, da maior para a menor. */
export function shapeDifferences(asked: SignShape, read: SignShape): Scored[] {
  const a = asked.mean;
  const b = read.mean;
  const out: Scored[] = [];

  const fingers = LONG_FINGERS.map((d, k) => {
    const diff = weighted(a.flex[k].map((v, i) => v - b.flex[k][i]));
    const noise = (weighted(asked.sd.flex[k]) + weighted(read.sd.flex[k])) / 2;
    const score = diff / (LIMIAR.dobra + noise);
    const sa = fingerState(a.flex[k]);
    const sb = fingerState(b.flex[k]);
    const v: FingerChange = sa !== sb ? sa : sumFlex(a.flex[k]) > sumFlex(b.flex[k]) ? 'maisDobrado' : 'maisEsticado';
    return { d, v, score };
  });
  // Três ou quatro dedos mudando do mesmo jeito (O e C, E e X): um item só, mais forte que cada dedo
  const grouped = new Set<LongFinger>();
  for (const v of new Set(fingers.map((f) => f.v))) {
    const members = fingers.filter((f) => f.v === v && f.score >= GRUPO.minimo);
    const mean = members.reduce((s, f) => s + f.score, 0) / (members.length || 1);
    if (members.length < 3 || mean < GRUPO.media) continue;
    members.forEach((f) => grouped.add(f.d));
    out.push({ item: { k: 'dedos', d: members.map((f) => f.d), v }, score: mean * GRUPO.peso });
  }
  for (const f of fingers) if (!grouped.has(f.d)) out.push({ item: { k: 'dedo', d: f.d, v: f.v }, score: f.score });

  // Abertura entre dedos vizinhos: só entre dedos esticados nos dois sinais
  for (let k = 0; k < 3; k++) {
    const pair: [LongFinger, LongFinger] = [LONG_FINGERS[k], LONG_FINGERS[k + 1]];
    const open = (s: Shape) => sumFlex(s.flex[k]) < 1.5 && sumFlex(s.flex[k + 1]) < 1.5;
    if (!open(a) || !open(b)) continue;
    const diff = Math.abs(a.gap[k] - b.gap[k]);
    const noise = (asked.sd.gap[k] + read.sd.gap[k]) / 2;
    const v = a.gap[k] > b.gap[k] ? 'separados' : 'juntos';
    // A palavra tem de valer para o sinal pedido (juntos de verdade ou separados de verdade)
    if (v === 'separados' ? a.gap[k] < LIMIAR.abertura : a.gap[k] > LIMIAR.abertura) continue;
    out.push({ item: { k: 'abertura', d: pair, v }, score: diff / (LIMIAR.abertura + noise) });
  }

  // Indicador e médio cruzados (R)
  if ((a.cross > 0.5 && b.cross < 0.3) || (a.cross < 0.3 && b.cross > 0.5)) {
    out.push({
      item: { k: 'cruzados', v: a.cross > 0.5 ? 'cruzados' : 'ladoALado' },
      score: Math.abs(a.cross - b.cross) / LIMIAR.cruzados,
    });
  }

  // Polegar: a ponta mudou de lugar e o lugar tem outro nome
  const ta = thumbState(a);
  const tb = thumbState(b);
  if (ta.v !== tb.v || ta.d !== tb.d) {
    const diff = Math.hypot(...a.thumbTip.map((v, i) => v - b.thumbTip[i]));
    const noise = (Math.hypot(...asked.sd.thumbTip) + Math.hypot(...read.sd.thumbTip)) / 2;
    out.push({ item: { k: 'polegar', ...ta }, score: diff / (LIMIAR.polegar + noise) });
  }

  // Para onde a mão aponta (nas letras com movimento, a direção média do caminho)
  const da = direction(a.point);
  if (da !== direction(b.point)) out.push({ item: { k: 'direcao', v: da }, score: angle(a.point, b.point) / LIMIAR.direcao });

  return out.sort((x, y) => y.score - x.score);
}

export function digitsOf(item: HintItem): Digit[] {
  switch (item.k) {
    case 'dedo': return [item.d];
    case 'dedos': return [...item.d];
    case 'polegar': return ['thumb'];
    case 'abertura': return [...item.d];
    case 'cruzados': return ['index', 'middle'];
    default: return [];
  }
}

export function comparePair(asked: SignShape, read: SignShape): PairDiff {
  const found = shapeDifferences(asked, read).filter((s) => s.score >= 1);
  let items = found.filter((s, i) => i === 0 || (i === 1 && s.score >= SEGUNDO * found[0].score)).map((s) => s.item);
  // Dois dedos que mudam do mesmo jeito viram uma frase só ("o anelar e o mínimo ficam esticados")
  const [x, y] = items;
  if (items.length === 2 && x.k === 'dedo' && y.k === 'dedo' && x.v === y.v) {
    items = [{ k: 'dedos', d: LONG_FINGERS.filter((f) => f === x.d || f === y.d), v: x.v }];
  }
  // A forma é a mesma: a diferença é o movimento (C e Ç, I e J, H e K)
  if (items.length === 0 && (asked.moving || read.moving)) {
    items = [{ k: 'movimento', v: asked.moving && read.moving ? 'outroMovimento' : asked.moving ? 'pedidoMove' : 'pedidoParado' }];
  }
  const order: Digit[] = ['thumb', ...LONG_FINGERS];
  const d = order.filter((g) => items.some((it) => digitsOf(it).includes(g)));
  return { d, i: items };
}
