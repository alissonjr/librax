/*
 * Linha do tempo do movimento das letras com movimento, em volta: parada no começo, o movimento
 * real (quadros a 15 por segundo), parada no fim e a volta suave ao começo. Sem three.js, para
 * testar sozinha.
 */
import { FPS } from './poses';

export const LEAD_MS = 400;
export const HOLD_MS = 700;
export const RETURN_MS = 550;

/** Quadro a mostrar: a mistura do quadro `from` com o `to` (t de 0 a 1). */
export interface Sample {
  from: number;
  to: number;
  t: number;
}

/** Curva padrão do design system (motion.easing.standard), aproximada. */
export function easeStandard(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function cycleMs(frames: number): number {
  return LEAD_MS + ((frames - 1) / FPS) * 1000 + HOLD_MS + RETURN_MS;
}

/** Onde está a volta no instante `ms` (já na velocidade escolhida). Um quadro só: sempre ele. */
export function sampleAt(frames: number, ms: number): Sample {
  if (frames <= 1) return { from: 0, to: 0, t: 0 };
  const total = cycleMs(frames);
  let m = ((ms % total) + total) % total;
  if (m < LEAD_MS) return { from: 0, to: 0, t: 0 };
  m -= LEAD_MS;
  const moveMs = ((frames - 1) / FPS) * 1000;
  if (m < moveMs) {
    const f = (m / 1000) * FPS;
    const i = Math.min(frames - 1, Math.floor(f));
    return { from: i, to: Math.min(frames - 1, i + 1), t: f - i };
  }
  m -= moveMs;
  if (m < HOLD_MS) return { from: frames - 1, to: frames - 1, t: 0 };
  m -= HOLD_MS;
  return { from: frames - 1, to: 0, t: easeStandard(Math.min(1, m / RETURN_MS)) };
}

/** Instante (ms na volta) do meio do movimento: a foto do "meio do movimento". */
export function midMovementMs(frames: number): number {
  return LEAD_MS + ((frames - 1) / FPS) * 500;
}
