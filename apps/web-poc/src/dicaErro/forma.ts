/*
 * Forma da mão desenhada pela mão em 3D (src/mao3d/), em números que dá para comparar entre dois
 * sinais: a dobra de cada dedo, a abertura entre dedos vizinhos, os dedos cruzados, onde fica o
 * polegar e para onde a mão aponta. Sem three.js: entra no script que gera as dicas
 * (scripts/gerar-dicas-erro.ts) e nos testes.
 *
 * Tudo no referencial da palma (x do mínimo para o indicador, y do pulso para a base do médio,
 * z = x * y), com a palma (pulso -> base do médio) = 1, a não ser a direção da mão (na cena).
 */

export const LONG_FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type LongFinger = (typeof LONG_FINGERS)[number];
export const DIGITS = ['thumb', ...LONG_FINGERS] as const;
export type Digit = (typeof DIGITS)[number];

/** Um quadro da mão desenhada. */
export interface DrawnFrame {
  /** 21 articulações na ordem do MediaPipe, na cena (x para a direita, y para cima, z para quem olha), palma = 1. */
  joints: readonly number[];
  /** Dobra de MCP, PIP e DIP (radianos, positivo fecha) de indicador, médio, anelar e mínimo, depois da colisão. */
  flex: readonly (readonly number[])[];
  /** Indicador e médio cruzados (0 a 1). */
  cross: number;
}

/** Forma de um quadro (ou a média de vários). */
export interface Shape {
  /** [dedo][MCP, PIP, DIP], radianos. */
  flex: number[][];
  /** Ângulo entre as falanges de base de dedos vizinhos, no plano da palma: [indicador-médio, médio-anelar, anelar-mínimo]. */
  gap: number[];
  cross: number;
  /** Ponta do polegar no referencial da palma. */
  thumbTip: number[];
  /** Distância da ponta do polegar ao dedo (a falange mais perto), por dedo. */
  thumbTouch: number[];
  /** Distância da ponta do polegar à ponta de cada dedo. */
  thumbTipTouch: number[];
  /** Distância da ponta do polegar à base do indicador (polegar esticado e afastado: grande). */
  thumbReach: number;
  /** Lado da palma em que fica a ponta do polegar (+: na frente da palma, para onde os dedos dobram). */
  thumbFront: number;
  /** Ponta do polegar em relação à frente das falanges dos dedos dobrados (+: na frente deles, por cima). */
  thumbOverFingers: number;
  /** Para onde os dedos apontam (eixo y da palma, na cena) e para onde a palma olha. */
  point: number[];
  face: number[];
}

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V) => Math.sqrt(dot(a, a));
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => scale(a, 1 / (len(a) || 1e-9));
const cross3 = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function segDist(p: V, a: V, b: V): number {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1e-9)));
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]));
}

const BASE: Record<LongFinger, number> = { index: 5, middle: 9, ring: 13, pinky: 17 };

/**
 * Lado da palma no referencial (z = x * y com x para o indicador e y para os dedos): os dedos
 * dobram para +z nas poses (mão direita, vista de quem olha a pessoa).
 */
export const PALM_SIDE = 1;

export function frameShape(f: DrawnFrame): Shape {
  const J = (i: number): V => [f.joints[i * 3], f.joints[i * 3 + 1], f.joints[i * 3 + 2]];
  const w = J(0);
  const y = norm(sub(J(9), w));
  let x = sub(J(5), J(17));
  x = norm(sub(x, scale(y, dot(x, y))));
  const z = cross3(x, y);
  const palmLen = len(sub(J(9), w)) || 1;
  // Ponto no referencial da palma
  const P = (i: number): V => {
    const d = sub(J(i), w);
    return [dot(d, x) / palmLen, dot(d, y) / palmLen, dot(d, z) / palmLen];
  };
  const pts = Array.from({ length: 21 }, (_, i) => P(i));
  const tip = pts[4];
  const thumbTouch = LONG_FINGERS.map((fg) => {
    const b = BASE[fg];
    return Math.min(segDist(tip, pts[b], pts[b + 1]), segDist(tip, pts[b + 1], pts[b + 2]), segDist(tip, pts[b + 2], pts[b + 3]));
  });
  const thumbTipTouch = LONG_FINGERS.map((fg) => len(sub(tip, pts[BASE[fg] + 3])));
  const gap = [0, 1, 2].map((k) => {
    const a = BASE[LONG_FINGERS[k]];
    const b = BASE[LONG_FINGERS[k + 1]];
    const da = sub(pts[a + 1], pts[a]);
    const db = sub(pts[b + 1], pts[b]);
    const aa = Math.atan2(da[0], da[1]);
    const ab = Math.atan2(db[0], db[1]);
    return Math.abs(Math.atan2(Math.sin(aa - ab), Math.cos(aa - ab)));
  });
  // Frente das falanges do meio dos dedos (no lado da palma): o polegar por cima dos dedos dobrados
  // fica mais para fora da palma do que elas
  const front = Math.max(...LONG_FINGERS.map((fg) => PALM_SIDE * pts[BASE[fg] + 1][2]));
  return {
    flex: f.flex.map((a) => [...a]),
    gap,
    cross: f.cross,
    thumbTip: [...tip],
    thumbTouch,
    thumbTipTouch,
    thumbReach: len(sub(tip, pts[5])),
    thumbFront: PALM_SIDE * tip[2],
    thumbOverFingers: PALM_SIDE * tip[2] - front,
    point: [...y],
    face: [...scale(z, PALM_SIDE)],
  };
}

/** Os números da forma numa lista (a mesma ordem em toShape). */
export function shapeVector(s: Shape): number[] {
  return [
    ...s.flex.flat(), ...s.gap, s.cross, ...s.thumbTip, ...s.thumbTouch, ...s.thumbTipTouch, s.thumbReach,
    s.thumbFront, s.thumbOverFingers, ...s.point, ...s.face,
  ];
}

export function toShape(v: readonly number[]): Shape {
  let i = 0;
  const take = (n: number) => v.slice(i, (i += n));
  const flex = [take(3), take(3), take(3), take(3)];
  return {
    flex,
    gap: take(3),
    cross: take(1)[0],
    thumbTip: take(3),
    thumbTouch: take(4),
    thumbTipTouch: take(4),
    thumbReach: take(1)[0],
    thumbFront: take(1)[0],
    thumbOverFingers: take(1)[0],
    point: take(3),
    face: take(3),
  };
}

/** Forma média de um sinal e quanto ela varia entre as pessoas (desvio por número). */
export interface SignShape {
  mean: Shape;
  sd: Shape;
  /** Quantas pessoas entraram na média. */
  people: number;
  /** Letra com movimento (H, J, K, X, Z, Ç). */
  moving: boolean;
}

/**
 * Junta as pessoas de um sinal: a média dos quadros de cada pessoa e, entre as pessoas, a média e o
 * desvio. Direções (point, face) voltam a ter comprimento 1.
 */
export function signShape(people: readonly (readonly Shape[])[], moving: boolean): SignShape {
  const avg = (vs: readonly number[][]) => vs[0].map((_, k) => vs.reduce((a, v) => a + v[k], 0) / vs.length);
  const perPerson = people.filter((p) => p.length > 0).map((frames) => avg(frames.map(shapeVector)));
  if (perPerson.length === 0) throw new Error('sinal sem quadros');
  const mean = avg(perPerson);
  const sd = mean.map((m, k) => Math.sqrt(perPerson.reduce((a, v) => a + (v[k] - m) ** 2, 0) / perPerson.length));
  const s = toShape(mean);
  s.point = [...norm(s.point as V)];
  s.face = [...norm(s.face as V)];
  return { mean: s, sd: toShape(sd), people: perPerson.length, moving };
}
