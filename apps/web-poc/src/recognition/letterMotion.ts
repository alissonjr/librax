import type { Lm } from '../lib/recognizer';
import { isLeftHand, normalizeHand, FEATURE_DIM } from './normalize';
import { predict, type MlpModel } from './mlp';
import { defaultReadingRules, windowMotion, type MotionSlot, type ReadingRules } from './readingRules';

/**
 * Letras com movimento do alfabeto manual (H, J, K, X, Z e Ç): entrada do modelo e reconhecedor
 * ao vivo. Só as mãos, sem o corpo: o PoseLandmarker não carrega para as letras.
 *
 * Contrato com o treino (ml-training/train_letras_mov.py: mao_do_quadro, rotulo_janela, janela e
 * compactar). O teste src/__tests__/letrasMovParidade.test.ts confere as duas contas com o fixture
 * de scripts/gerar-fixture-letras-mov.py. Mudou algo aqui, muda lá, gera o fixture e treina de novo.
 *
 * Janela [t0, t1]:
 * 1. Mão de cada quadro: a mais alta (menor y do pulso). Rótulo da janela: o rótulo do MediaPipe
 *    que mais aparece entre as mãos escolhidas nos quadros da janela (empate: o primeiro que
 *    apareceu). A janela inteira é espelhada por esse rótulo, como na normalizeHand.
 * 2. Por quadro: presença, pulso (x * aspecto, y), palmo (distância 3D pulso -> base do médio, x e
 *    z vezes o aspecto) e os 65 da normalizeHand com o rótulo da janela.
 * 3. Reamostragem em WINDOW_FRAMES passos de t0 a t1: a presença é interpolada entre todos os
 *    quadros e arredondada em 0,5; o resto só entre os quadros com mão (fora do intervalo vale o
 *    primeiro ou o último, como o np.interp). Passo sem mão fica todo zero.
 * 4. Por passo (LETTER_FRAME_DIM = 69): presença, pulso x e y menos a média dos passos com mão,
 *    divididos pelo palmo médio (x espelhado), log(palmo / palmo médio) e os 65 da normalizeHand.
 * 5. MODEL_FRAMES passos espalhados, achatados.
 * Janela com mão em menos de MIN_PRESENCE dos quadros entre t0 e t1 não é avaliada.
 */

export const LETTER_WINDOW_FRAMES = 24;
export const LETTER_MODEL_FRAMES = 8;
export const LETTER_FRAME_DIM = 4 + FEATURE_DIM;
export const LETTER_INPUT_DIM = LETTER_MODEL_FRAMES * LETTER_FRAME_DIM;
/** Janelas avaliadas (segundos), as do treino (JANELAS_S). */
export const LETTER_WINDOWS_S: readonly number[] = [0.8, 1.2, 1.6];
export const MIN_PRESENCE = 0.6;
/** Quadros guardados: a janela mais longa e uma folga (BUFFER_S do treino). */
export const LETTER_BUFFER_S = 2.0;
/** Intervalo entre avaliações (AVALIA_S do treino). */
export const LETTER_EVAL_MS = 250;
/** Abaixo disto a leitura vira "nenhuma letra" (o mesmo limiar das letras paradas). */
export const LETTER_MIN_PROBABILITY = 0.6;
export const NO_LETTER = '_';
/** Janela só é avaliada quando o buffer cobre pelo menos esta fração dela (como nos sinais). */
const MIN_COVERAGE = 0.9;
/** Presença, pulso (em palmos) e os 65 da normalizeHand em cada passo, para o movimento da janela. */
const LETTER_MOTION_SLOTS: readonly MotionSlot[] = [{ presence: 0, wrist: 1, shape: [4, LETTER_FRAME_DIM] }];

/** Movimento da janela (entrada do modelo): o movimento() do train_letras_mov.py. */
export function letterWindowMotion(input: ArrayLike<number>, shapeWeight: number): number {
  return windowMotion(input, LETTER_MODEL_FRAMES, LETTER_FRAME_DIM, LETTER_MOTION_SLOTS, shapeWeight);
}

/** Regras de leitura sem o model.json dizer outras: só o limiar. */
export const DEFAULT_LETTER_RULES: ReadingRules = defaultReadingRules(LETTER_MIN_PROBABILITY);

export interface LetterHand {
  /** categoryName do MediaPipe ('Left' ou 'Right', invertido no quadro não espelhado). */
  handedness: string | null;
  landmarks: readonly Lm[];
}

export interface LetterFrame {
  /** Segundos. */
  t: number;
  hands: readonly LetterHand[];
}

/** A mão mais alta do quadro (menor y do pulso), ou null. Empate fica com a primeira. */
export function frameHand(hands: readonly LetterHand[]): LetterHand | null {
  let best: LetterHand | null = null;
  for (const h of hands) if (!best || h.landmarks[0].y < best.landmarks[0].y) best = h;
  return best;
}

/** Rótulo que mais aparece entre as mãos escolhidas em [t0, t1] (empate: o primeiro que apareceu). */
export function windowHandedness(frames: readonly LetterFrame[], t0: number, t1: number): string | null {
  const count = new Map<string | null, number>();
  for (const f of frames) {
    if (f.t < t0 || f.t > t1) continue;
    const h = frameHand(f.hands);
    if (h) count.set(h.handedness, (count.get(h.handedness) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [label, c] of count) if (c > n) { best = label; n = c; }
  return best;
}

/** Fração dos quadros em [t0, t1] com mão (0 sem quadros). */
export function presenceFraction(frames: readonly LetterFrame[], t0: number, t1: number): number {
  let inside = 0;
  let withHand = 0;
  for (const f of frames) {
    if (f.t < t0 || f.t > t1) continue;
    inside++;
    if (f.hands.length > 0) withHand++;
  }
  return inside ? withHand / inside : 0;
}

/** Distância 3D pulso -> base do médio, com x e z vezes o aspecto. */
export function palmLength(lm: readonly Lm[], aspect: number): number {
  const dx = (lm[9].x - lm[0].x) * aspect;
  const dy = lm[9].y - lm[0].y;
  const dz = (lm[9].z - lm[0].z) * aspect;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** n pontos de a até b, como o np.linspace (o último é b exato). */
function linspace(a: number, b: number, n: number): number[] {
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + i * step));
}

/** np.interp de um ponto: xs crescente; fora do intervalo vale a ponta. */
function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (xs[m] <= x) lo = m;
    else hi = m;
  }
  return ys[lo] + (ys[hi] - ys[lo]) * ((x - xs[lo]) / (xs[hi] - xs[lo]));
}

/**
 * Janela [t0, t1] -> LETTER_WINDOW_FRAMES linhas de LETTER_FRAME_DIM, ou null quando não dá para
 * avaliar. `frames` em ordem de tempo; os de fora da janela entram na interpolação das pontas.
 */
export function letterWindow(frames: readonly LetterFrame[], aspect: number, t0: number, t1: number): Float64Array[] | null {
  if (presenceFraction(frames, t0, t1) < MIN_PRESENCE) return null;
  const label = windowHandedness(frames, t0, t1);
  const ts = frames.map(f => f.t);
  const presence = frames.map(f => (f.hands.length > 0 ? 1 : 0));
  const tp: number[] = [];
  const cols: number[][] = [];
  for (const f of frames) {
    const h = frameHand(f.hands);
    if (!h) continue;
    const lm = h.landmarks;
    tp.push(f.t);
    cols.push([lm[0].x * aspect, lm[0].y, palmLength(lm, aspect), ...normalizeHand(lm, { handedness: label, aspect })]);
  }
  const target = linspace(t0, t1, LETTER_WINDOW_FRAMES);
  const p = target.map(x => (interp(x, ts, presence) >= 0.5 ? 1 : 0));
  if (tp.length === 0 || !p.some(v => v > 0)) return null;

  const width = cols[0].length;
  const column = (j: number) => cols.map(c => c[j]);
  const R = target.map(() => new Float64Array(width));
  for (let j = 0; j < width; j++) {
    const ys = column(j);
    target.forEach((x, i) => { R[i][j] = interp(x, tp, ys); });
  }
  let mx = 0;
  let my = 0;
  let mp = 0;
  let n = 0;
  R.forEach((row, i) => {
    if (!p[i]) return;
    mx += row[0];
    my += row[1];
    mp += row[2];
    n++;
  });
  mx /= n;
  my /= n;
  const palm = Math.max(mp / n, 1e-6);
  const sign = isLeftHand(label) ? -1 : 1;
  return R.map((row, i) => {
    const out = new Float64Array(LETTER_FRAME_DIM);
    if (!p[i]) return out;
    out[0] = 1;
    out[1] = (sign * (row[0] - mx)) / palm;
    out[2] = (row[1] - my) / palm;
    out[3] = Math.log(Math.max(row[2], 1e-6) / palm);
    out.set(row.subarray(3), 4);
    return out;
  });
}

/** Passos que entram no modelo: np.linspace(0, T - 1, PASSOS).round(). */
export const LETTER_MODEL_FRAME_INDEX: readonly number[] = linspace(0, LETTER_WINDOW_FRAMES - 1, LETTER_MODEL_FRAMES).map(Math.round);

/** Janela -> entrada do modelo (LETTER_INPUT_DIM números). */
export function compactLetterWindow(window: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(LETTER_INPUT_DIM);
  LETTER_MODEL_FRAME_INDEX.forEach((idx, i) => out.set(window[idx], i * LETTER_FRAME_DIM));
  return out;
}

/* ---------- reconhecedor ao vivo ---------- */

export interface LetterMotionReading {
  /** Letra lida (probabilidade >= LETTER_MIN_PROBABILITY e não "_"), ou null. */
  letter: string | null;
  probability: number;
  /** Maior probabilidade de cada rótulo entre as janelas avaliadas, na ordem de `labels`. */
  probs: Float64Array;
  /** Janelas avaliadas (0: buffer curto, sem mão ou mão parada). */
  windows: number;
}

export interface LetterMotionRecognizer {
  readonly labels: readonly string[];
  /** Acrescenta um quadro (tempos crescentes; quadro fora de ordem é ignorado). */
  push(frame: LetterFrame, aspect: number): void;
  /** Avalia as janelas que terminam no quadro mais recente. */
  evaluate(): LetterMotionReading;
  /** Entradas do modelo de cada janela avaliável agora (usado pelo evaluate e pelos testes). */
  windowInputs(): { duration: number; input: Float64Array }[];
  size(): number;
  reset(): void;
}

/**
 * Guarda os últimos LETTER_BUFFER_S segundos e, a cada chamada do evaluate (a câmera chama a cada
 * LETTER_EVAL_MS), passa pelo MLP as janelas de LETTER_WINDOWS_S que terminam no quadro mais
 * recente que se mexem o bastante (portão de movimento das regras, readingRules.ts). Vale a letra
 * (não "_") de maior probabilidade, se passar do limiar e o "_" da janela não passar do teto: o
 * mesmo critério do leituras() do treino e do reconhecedor dos sinais.
 */
export function createLetterMotionRecognizer(
  model: MlpModel, rules: ReadingRules = DEFAULT_LETTER_RULES,
): LetterMotionRecognizer {
  let frames: LetterFrame[] = [];
  let aspect = 1;
  const none = model.labels.indexOf(NO_LETTER);

  const windowInputs = () => {
    if (frames.length < 2) return [];
    const tEnd = frames[frames.length - 1].t;
    const span = tEnd - frames[0].t;
    const out: { duration: number; input: Float64Array }[] = [];
    for (const duration of LETTER_WINDOWS_S) {
      if (span < duration * MIN_COVERAGE) continue;
      const w = letterWindow(frames, aspect, tEnd - duration, tEnd);
      if (w) out.push({ duration, input: compactLetterWindow(w) });
    }
    return out;
  };

  return {
    labels: model.labels,
    push(frame, frameAspect) {
      const last = frames[frames.length - 1];
      if (last && frame.t <= last.t) return;
      if (Number.isFinite(frameAspect) && frameAspect > 0) aspect = frameAspect;
      frames.push(frame);
      const keepFrom = frame.t - LETTER_BUFFER_S;
      let drop = 0;
      while (drop < frames.length && frames[drop].t < keepFrom) drop++;
      if (drop > 0) frames = frames.slice(drop);
    },
    windowInputs,
    evaluate() {
      const probs = new Float64Array(model.labels.length);
      let letter: string | null = null;
      let probability = 0;
      // Portão de movimento: janela com a mão parada nem passa pelo modelo
      const inputs = windowInputs().filter(w => letterWindowMotion(w.input, rules.motionShapeWeight) >= rules.minMotion);
      for (const { input } of inputs) {
        const p = predict(model, input);
        let best = 0;
        for (let j = 0; j < p.length; j++) {
          if (p[j] > probs[j]) probs[j] = p[j];
          if (p[j] > p[best]) best = j;
        }
        const noneOk = none < 0 || p[none] <= rules.maxNoneProbability;
        if (best !== none && p[best] >= rules.minProbability && noneOk && p[best] > probability) {
          letter = model.labels[best];
          probability = p[best];
        }
      }
      return { letter, probability, probs, windows: inputs.length };
    },
    size: () => frames.length,
    reset() {
      frames = [];
    },
  };
}
