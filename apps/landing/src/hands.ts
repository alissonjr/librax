import maos from './maos.json';

/** 42 números: x, y dos 21 pontos da mão (pulso em 0,0 e base do dedo médio em 0,-1). */
export type Pose = readonly number[];

/** As mesmas ligações do esqueleto da câmera do app (cameraUtils.ts / MediaPipe). */
export const HAND_LINKS: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export const HERO_LETTERS = ['L', 'I', 'B', 'R', 'A', 'X'] as const;
export type HeroLetter = (typeof HERO_LETTERS)[number];

const r = (v: number) => Math.round(v * 1000) / 1000;

/** Um "M x y L x y" por osso: o esqueleto inteiro num path só. */
export function bonesPath(p: Pose): string {
  return HAND_LINKS.map(([a, b]) => `M${r(p[a * 2])} ${r(p[a * 2 + 1])}L${r(p[b * 2])} ${r(p[b * 2 + 1])}`).join('');
}

/** Caixa quadrada da letra: mesma escala em todas (lado comum), centrada nas mãos da letra. */
export function handViewBox(letter: string): string {
  const info = (maos.letras as Record<string, { centro: number[] }>)[letter];
  const side = maos.lado * 1.08;
  const [cx, cy] = info?.centro ?? [0, -1];
  return `${r(cx - side / 2)} ${r(cy - side / 2)} ${r(side)} ${r(side)}`;
}

/** Mistura de duas poses (t de 0 a 1). */
export function lerpPose(a: Pose, b: Pose, t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t);
}

/** Curva padrão do design system (motion.easing.standard, 0.2 0 0 1), aproximada. */
export function easeStandard(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
