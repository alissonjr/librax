import { HAND_CONNECTIONS, type Lm } from './recognizer';
import { tokens } from '../styles/tokens';

/**
 * Estados visuais do esqueleto da mão (seção 4.3 e 11.7 da proposta de design system).
 * A cor sempre vem acompanhada de outra pista: a espessura muda no acerto e a referência é tracejada.
 */
export type SkeletonState = 'idle' | 'tracking' | 'ready' | 'correct' | 'retry' | 'reference';

const COLORS: Record<SkeletonState, string> = {
  idle: tokens['stage.landmark.idle'],
  tracking: tokens['stage.landmark.tracking'],
  ready: tokens['stage.landmark.ready'],
  correct: tokens['stage.landmark.correct'],
  retry: tokens['stage.landmark.retry'],
  reference: tokens['stage.landmark.reference'],
};
const HALO = tokens['stage.landmark.halo'];

/** Espessuras em px de tela (CSS); convertidas para a resolução do canvas no desenho. */
const LINE = 2.5;
const JOINT = 4;
const LINE_CORRECT = 3.5;
const JOINT_CORRECT = 6;
/** O contorno escuro fica 2 px mais largo que a linha colorida. */
const HALO_EXTRA = 2;

/** Mapeia a confiança do reconhecimento para o estado do esqueleto. */
export function skeletonState(confidence: number): SkeletonState {
  if (confidence > 0.7) return 'ready';
  if (confidence > 0.4) return 'tracking';
  return 'idle';
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Desenha o esqueleto 2D da mão no canvas sobre o vídeo.
 * Cada linha e articulação é desenhada primeiro com o contorno escuro (halo) e depois na
 * cor do estado, para ficar legível sobre qualquer vídeo. O canvas é espelhado por CSS.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: Lm[],
  w: number,
  h: number,
  confidence = 0,
  state: SkeletonState = skeletonState(confidence),
  /** false desenha por cima do que já está no canvas (a segunda mão dos sinais com movimento). */
  clear = true,
): void {
  if (!w || !h || landmarks.length < 21) return;
  if (clear) ctx.clearRect(0, 0, w, h);

  // O canvas tem a resolução do vídeo; escala as medidas para px de tela
  const shown = ctx.canvas?.clientWidth ?? 0;
  const k = shown > 0 ? w / shown : 1;

  const isCorrect = state === 'correct';
  const line = (isCorrect ? LINE_CORRECT : LINE) * k;
  const joint = (isCorrect ? JOINT_CORRECT : JOINT) * k;
  const halo = HALO_EXTRA * k;
  const color = COLORS[state];
  const pts = landmarks.map(lm => ({ x: lm.x * w, y: lm.y * h }));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(state === 'reference' ? [6 * k, 5 * k] : []);

  const strokeBones = (width: number, stroke: string) => {
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
    }
    ctx.stroke();
  };

  const fillJoints = (radius: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (const p of pts) {
      ctx.moveTo(p.x + radius, p.y);
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    }
    ctx.fill();
  };

  // 1. Contorno escuro
  strokeBones(line + halo, HALO);
  fillJoints(joint + halo / 2, HALO);

  // 2. Cor do estado (brilho só no acerto e só sem "reduzir movimento")
  if (isCorrect && !prefersReducedMotion()) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * k;
  }
  strokeBones(line, color);
  ctx.setLineDash([]);
  fillJoints(joint, color);
  ctx.restore();
}
