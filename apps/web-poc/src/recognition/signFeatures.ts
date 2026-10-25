import type { Lm } from '../lib/recognizer';
import { isLeftHand, normalizeHand, FEATURE_DIM } from './normalize';

/**
 * Entrada do modelo dos sinais com movimento (contrato entre o app e o treino).
 *
 * A mesma conta existe em Python: features_quadro, mao_dominante e reamostrar em
 * ml-training/video/rotular_sinais.py e compactar em ml-training/train_sinais.py. O teste
 * src/__tests__/sinaisParidade.test.ts confere as duas com o fixture de
 * scripts/gerar-fixture-sinais.py. Mudou algo aqui, muda lá, gera o fixture e treina de novo.
 *
 * Por quadro (F = 140), para a mão dominante e depois a outra (70 cada):
 * [presença, pulso x/y a partir do meio dos ombros, pulso x/y a partir do nariz, 65 da
 * normalizeHand]. Posições em larguras de ombro (PoseLandmarker: nariz 0, ombros 11 e 12), x
 * multiplicado pelo aspecto do vídeo e espelhado quando a dominante é a mão esquerda da pessoa.
 * Mão ausente: tudo zero. Quadro sem corpo (ou com os ombros juntos) não tem atributos e conta
 * como zero na reamostragem.
 *
 * Janela: [t0, t1] reamostrada linearmente em T = 24 quadros (presença arredondada em 0,5) e
 * compactada em PASSOS = 8 quadros espalhados, achatados em 8 x 140 = 1120 números.
 */

export const NOSE = 0;
export const LEFT_SHOULDER = 11;
export const RIGHT_SHOULDER = 12;
/** Atributos de cada mão. */
export const PER_HAND = 5 + FEATURE_DIM;
/** Atributos por quadro. */
export const SIGN_FRAME_DIM = 2 * PER_HAND;
/** Quadros da janela reamostrada (window_frames do model.json). */
export const WINDOW_FRAMES = 24;
/** Quadros que entram no modelo (frames do model.json). */
export const MODEL_FRAMES = 8;
export const SIGN_INPUT_DIM = MODEL_FRAMES * SIGN_FRAME_DIM;
/** Pulso abaixo disto (em larguras de ombro, a partir da linha dos ombros) não é mão levantada. */
export const ACTIVE_BELOW_SHOULDER = 1.8;

export interface SignHand {
  /** categoryName do MediaPipe ('Left' ou 'Right', invertido no quadro não espelhado). */
  handedness: string | null;
  landmarks: readonly Lm[];
}

export interface SignFrame {
  /** Segundos. */
  t: number;
  hands: readonly SignHand[];
  /** Pontos do PoseLandmarker (pelo menos até o 12), ou null sem corpo. */
  pose: readonly Lm[] | null;
}

/**
 * Rótulo do MediaPipe da mão que mais se mexe (soma do deslocamento do pulso entre aparições do
 * mesmo rótulo). Null quando nenhuma mão aparece duas vezes. Empate fica com o rótulo que começou
 * a se mexer primeiro, como o max do Python.
 */
export function dominantHand(frames: readonly SignFrame[], aspect: number): string | null {
  const last = new Map<string | null, [number, number]>();
  const movement = new Map<string | null, number>();
  for (const f of frames) {
    for (const h of f.hands) {
      const w = h.landmarks[0];
      const p: [number, number] = [w.x * aspect, w.y];
      const prev = last.get(h.handedness);
      if (prev) movement.set(h.handedness, (movement.get(h.handedness) ?? 0) + Math.hypot(p[0] - prev[0], p[1] - prev[1]));
      last.set(h.handedness, p);
    }
  }
  let best: string | null = null;
  let bestValue = -Infinity;
  for (const [label, value] of movement) {
    if (value > bestValue) { best = label; bestValue = value; }
  }
  return best;
}

/** Atributos do quadro (SIGN_FRAME_DIM), ou null sem corpo. */
export function frameFeatures(frame: SignFrame, aspect: number, dominant: string | null): Float64Array | null {
  const pose = frame.pose;
  if (!pose || pose.length <= RIGHT_SHOULDER) return null;
  const le = [pose[LEFT_SHOULDER].x * aspect, pose[LEFT_SHOULDER].y];
  const ri = [pose[RIGHT_SHOULDER].x * aspect, pose[RIGHT_SHOULDER].y];
  const width = Math.hypot(le[0] - ri[0], le[1] - ri[1]);
  if (width < 1e-3) return null;
  const mid = [(le[0] + ri[0]) / 2, (le[1] + ri[1]) / 2];
  const nose = [pose[NOSE].x * aspect, pose[NOSE].y];
  const mirror = isLeftHand(dominant);

  // A dominante vai para a primeira vaga; rótulo repetido no quadro ocupa a vaga que sobrou
  const slots: [SignHand | null, SignHand | null] = [null, null];
  for (const h of frame.hands) {
    const slot = h.handedness === dominant ? 0 : 1;
    if (slots[slot] === null) slots[slot] = h;
    else if (slots[1 - slot] === null) slots[1 - slot] = h;
  }

  const out = new Float64Array(SIGN_FRAME_DIM);
  slots.forEach((h, k) => {
    if (!h) return;
    const wx = h.landmarks[0].x * aspect;
    const wy = h.landmarks[0].y;
    const sign = mirror ? -1 : 1;
    const base = k * PER_HAND;
    out[base] = 1;
    out[base + 1] = sign * ((wx - mid[0]) / width);
    out[base + 2] = (wy - mid[1]) / width;
    out[base + 3] = sign * ((wx - nose[0]) / width);
    out[base + 4] = (wy - nose[1]) / width;
    out.set(normalizeHand(h.landmarks, { handedness: h.handedness, aspect }), base + 5);
  });
  return out;
}

/** n pontos de a até b, como o np.linspace (o último é b exato). */
function linspace(a: number, b: number, n: number): number[] {
  const step = (b - a) / (n - 1);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? b : a + i * step));
}

/**
 * Janela [t0, t1] em WINDOW_FRAMES quadros: interpolação linear em cada atributo, como o
 * np.interp (fora do intervalo dos quadros vale o primeiro ou o último). Quadro sem atributos
 * (null) entra como zero. `ts` em ordem crescente.
 */
export function resampleWindow(
  ts: readonly number[],
  feats: readonly (Float64Array | null)[],
  t0: number,
  t1: number,
): Float64Array[] {
  const zero = new Float64Array(SIGN_FRAME_DIM);
  const rows = feats.map(f => f ?? zero);
  const n = ts.length;
  const out = linspace(t0, t1, WINDOW_FRAMES).map(x => {
    const row = new Float64Array(SIGN_FRAME_DIM);
    if (n === 0) return row;
    if (x <= ts[0]) { row.set(rows[0]); return row; }
    if (x >= ts[n - 1]) { row.set(rows[n - 1]); return row; }
    // Último quadro com ts[j] <= x
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= x) lo = m;
      else hi = m;
    }
    const a = rows[lo];
    const b = rows[hi];
    const f = (x - ts[lo]) / (ts[hi] - ts[lo]);
    for (let j = 0; j < SIGN_FRAME_DIM; j++) row[j] = a[j] + (b[j] - a[j]) * f;
    return row;
  });
  // Presença: a mão aparece ou não
  for (const row of out) {
    for (let k = 0; k < 2; k++) row[k * PER_HAND] = row[k * PER_HAND] >= 0.5 ? 1 : 0;
  }
  return out;
}

/** Índices dos quadros que entram no modelo: np.linspace(0, T - 1, PASSOS).round(). */
export const MODEL_FRAME_INDEX: readonly number[] = linspace(0, WINDOW_FRAMES - 1, MODEL_FRAMES).map(Math.round);

/** Janela reamostrada -> entrada do modelo (SIGN_INPUT_DIM números). */
export function compactWindow(window: readonly Float64Array[]): Float64Array {
  const out = new Float64Array(SIGN_INPUT_DIM);
  MODEL_FRAME_INDEX.forEach((idx, i) => out.set(window[idx], i * SIGN_FRAME_DIM));
  return out;
}

/** Algum quadro com mão levantada (perto da linha dos ombros ou acima), como o "ativo" do treino. */
export function hasRaisedHand(feats: readonly (Float64Array | null)[]): boolean {
  return feats.some(x => !!x && [0, 1].some(k => x[k * PER_HAND] > 0 && x[k * PER_HAND + 2] < ACTIVE_BELOW_SHOULDER));
}
