/*
 * Mãos reais da apresentação das letras e dos números (maos-licoes.json, gerado por
 * scripts/extrair-maos-licoes.ts). Só entra no pedaço do código da mão em 3D.
 */
import dados from './maos-licoes.json';

export const FPS = 15;

/** Uma pessoa: um quadro (letra ou número parado) ou o movimento quadro a quadro. */
export interface Person {
  /** 63 números por quadro: 21 pontos (x de quem olha, y para baixo, z do MediaPipe), palmo = 1. */
  frames: Float32Array[];
  /** Deslocamento do pulso em cada quadro (x de quem olha, y para baixo), em palmos. */
  wrist: [number, number][];
  /** Probabilidade com que o modelo do app leu a mão como o sinal. */
  prob: number;
}

export interface Clip {
  gloss: string;
  moving: boolean;
  people: Person[];
}

interface Entry {
  prob: number[];
  poses?: number[][];
  mov?: number[][][];
}

const sinais = dados.sinais as Record<string, Entry>;
const escala = dados.escala;

/** Glosas com mão em 3D nos dados. */
export function clipGlosses(): string[] {
  return Object.keys(sinais);
}

export function clipFor(gloss: string): Clip | null {
  const e = sinais[gloss];
  if (!e) return null;
  const pose = (q: readonly number[]) => Float32Array.from(q.slice(0, 63), (v) => v / escala);
  if (e.mov) {
    return {
      gloss,
      moving: true,
      people: e.mov.map((quadros, k) => ({
        frames: quadros.map(pose),
        wrist: quadros.map((q) => [q[63] / escala, q[64] / escala] as [number, number]),
        prob: e.prob[k],
      })),
    };
  }
  return {
    gloss,
    moving: false,
    people: (e.poses ?? []).map((q, k) => ({ frames: [pose(q)], wrist: [[0, 0]], prob: e.prob[k] })),
  };
}

/** Duração do movimento de uma pessoa (s). */
export function clipDuration(p: Person): number {
  return (p.frames.length - 1) / FPS;
}
