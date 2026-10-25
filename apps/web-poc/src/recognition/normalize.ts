import type { Lm } from '../lib/recognizer';

/**
 * Normalização dos 21 landmarks antes de classificar (contrato entre o app e o treino).
 *
 * A mesma conta existe em Python em ml-training/train_static.py (normalize_hand), e o teste de
 * paridade (src/__tests__/paridade.test.ts) confere as duas com vetores dourados. Qualquer
 * mudança aqui exige subir NORMALIZATION_VERSION, mudar o Python junto e treinar de novo:
 * o model.json traz a versão com que foi treinado e o app recusa modelo de versão diferente.
 *
 * Versão 1, nesta ordem:
 * 1. Aspecto: x e z do MediaPipe vêm em fração da largura e y em fração da altura. Multiplica
 *    x e z por largura/altura para as distâncias valerem igual nos dois eixos (o celular em pé
 *    entrega 480x640 e deitado 640x480; sem isso a mesma mão vira outro vetor).
 * 2. Translação: pulso (0) na origem.
 * 3. Escala: divide pela distância 3D pulso -> base do dedo médio (9). Distância zero usa fator
 *    1e6, igual à normalizeHand de referência (apps/mobile_flutter/lib/hand_skeleton.dart).
 * 4. Espelho: mão esquerda vira direita (x -> -x). O quadro do getUserMedia não vem espelhado
 *    (o espelho da tela é só CSS) e o MediaPipe rotula a mão supondo imagem espelhada, então o
 *    rótulo vem invertido: "Right" do MediaPipe é a mão esquerda da pessoa.
 * 5. Rotação no plano da imagem: gira em torno do eixo z até o vetor pulso -> dedo médio apontar
 *    para cima (0, -1). Se esse vetor não tiver componente no plano, não gira.
 * 6. Direção (versão 2): a rotação do passo 5 apaga para onde a mão aponta, e há letras que só
 *    mudam nisso (U para cima e H para o lado; K e P; G e Q). Os dois últimos números são o
 *    vetor unitário pulso -> dedo médio no plano antes de girar, já espelhado: (0, -1) é para
 *    cima. Sem componente no plano, vale (0, -1).
 *
 * Saída: 65 números [x0, y0, z0, x1, y1, z1, ..., x20, y20, z20, dirX, dirY].
 */
export const NORMALIZATION_VERSION = 2;
/** Landmarks brutos: 21 pontos x 3. */
export const RAW_DIM = 63;
export const FEATURE_DIM = RAW_DIM + 2;

/** O MediaPipe rotula a mão supondo quadro espelhado; o nosso quadro não é. */
const HANDEDNESS_INVERTED = true;

export interface NormalizeOptions {
  /** Rótulo do MediaPipe (categoryName de result.handedness[0][0]): 'Left' ou 'Right'. */
  handedness?: string | null;
  /** Largura / altura do quadro do vídeo. Padrão 1. */
  aspect?: number;
}

/** True quando é a mão esquerda da pessoa (considerando o rótulo invertido do MediaPipe). */
export function isLeftHand(handedness: string | null | undefined): boolean {
  if (handedness !== 'Left' && handedness !== 'Right') return false;
  return HANDEDNESS_INVERTED ? handedness === 'Right' : handedness === 'Left';
}

export function normalizeHand(landmarks: readonly Lm[], options: NormalizeOptions = {}): number[] {
  if (landmarks.length < 21) return [];
  const aspect = options.aspect && Number.isFinite(options.aspect) && options.aspect > 0 ? options.aspect : 1;
  const mirror = isLeftHand(options.handedness);

  const w = landmarks[0];
  const pts = landmarks.slice(0, 21).map(p => [
    (p.x - w.x) * aspect,
    p.y - w.y,
    (p.z - w.z) * aspect,
  ]);

  const [mx, my, mz] = pts[9];
  const scale = Math.sqrt(mx * mx + my * my + mz * mz);
  const f = scale === 0 ? 1e6 : 1 / scale;
  for (const p of pts) {
    p[0] *= f;
    p[1] *= f;
    p[2] *= f;
    if (mirror) p[0] = -p[0];
  }

  const a = pts[9][0];
  const b = pts[9][1];
  const n = Math.sqrt(a * a + b * b);
  const out = new Array<number>(FEATURE_DIM);
  const cos = n > 1e-9 ? -b / n : 1;
  const sin = n > 1e-9 ? -a / n : 0;
  pts.forEach(([x, y, z], i) => {
    out[i * 3] = x * cos - y * sin;
    out[i * 3 + 1] = x * sin + y * cos;
    out[i * 3 + 2] = z;
  });
  out[RAW_DIM] = n > 1e-9 ? a / n : 0;
  out[RAW_DIM + 1] = n > 1e-9 ? b / n : -1;
  return out;
}
