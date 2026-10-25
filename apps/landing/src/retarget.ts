/*
 * Retargeting dos 21 landmarks do MediaPipe para as 25 articulações da mão do WebXR (usada pelo
 * protótipo da abertura em 3D, src/mao3d.ts).
 *
 * As articulações do modelo (generic-hand do @webxr-input-profiles/assets) não formam hierarquia:
 * cada uma é filha direta da Armature e recebe posição e rotação próprias, como nas mãos do WebXR.
 * A conta, por pose:
 * 1. Palma: monta um referencial com pulso (0), base do indicador (5), base do mínimo (17) e base
 *    do médio (9), o mesmo no modelo em repouso; a rotação entre os dois gira o pulso, os
 *    metacarpos e as bases dos dedos como um bloco só (a palma não dobra).
 * 2. Dedos: cada osso parte da rotação do osso anterior (para herdar a torção) e gira até apontar
 *    na direção do landmark seguinte (5 -> 6, 6 -> 7, 7 -> 8...). Com limites de articulação:
 *    nas juntas do meio e da ponta dos dedos só dobra para a palma (dobradiça); na base, dobra
 *    e abre um pouco para os lados. Isso segura o ruído do z (dedo torto ou dobrado para trás).
 *    Nas articulações do WebXR o osso aponta para -Z e +Y sai pelas costas da mão (unhas).
 * 3. Posições: a partir das rotações, com os comprimentos do modelo (a mão mantém a proporção do
 *    modelo; da pose só vêm as direções, que pesam menos que as distâncias no ruído do z).
 *
 * As poses viram 25 rotações; a transição entre pessoas interpola as rotações (slerp) e refaz as
 * posições, sem os dedos encolherem no meio do caminho como na mistura direta dos pontos.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

/** Nomes das articulações do WebXR, na ordem do modelo. */
export const JOINTS = [
  'wrist',
  'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  'index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip',
  'middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip',
  'ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip',
  'pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip',
] as const;

type Kind = 'palm' | 'aim' | 'follow';
interface Spec {
  parent: number;
  /** palm: anda com a palma; aim: aponta para o landmark; follow: segue o osso anterior (ponta). */
  kind: Kind;
  /** Landmarks (de, para) da direção do osso, para kind 'aim'. */
  dir?: readonly [number, number];
  /** Posição presa à palma (true) ou na ponta do osso anterior. */
  rigid: boolean;
  /** Limite: dobradiça (meio e ponta do dedo) ou base do dedo (dobra e abre um pouco). */
  limit?: 'hinge' | 'base';
}

/** Limites em radianos: [mínimo, máximo] da dobra (positivo fecha para a palma) e da abertura. */
const HINGE: readonly [number, number] = [-0.08, 1.95];
const BASE_FLEX: readonly [number, number] = [-0.35, 1.7];
const BASE_SPREAD = 0.4;
const clamp = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));

/** Dedo com landmarks base (MCP) a: a, a+1, a+2, a+3 (ponta). */
function finger(meta: number, a: number): Spec[] {
  return [
    { parent: 0, kind: 'palm', rigid: true },
    { parent: meta, kind: 'aim', dir: [a, a + 1], rigid: true, limit: 'base' },
    { parent: meta + 1, kind: 'aim', dir: [a + 1, a + 2], rigid: false, limit: 'hinge' },
    { parent: meta + 2, kind: 'aim', dir: [a + 2, a + 3], rigid: false, limit: 'hinge' },
    { parent: meta + 3, kind: 'follow', rigid: false },
  ];
}

export const SPECS: readonly Spec[] = [
  { parent: -1, kind: 'palm', rigid: true },
  // Polegar: metacarpo no landmark 1, falange proximal no 2, distal no 3, ponta no 4
  { parent: 0, kind: 'aim', dir: [1, 2], rigid: true },
  { parent: 1, kind: 'aim', dir: [2, 3], rigid: false },
  { parent: 2, kind: 'aim', dir: [3, 4], rigid: false, limit: 'hinge' },
  { parent: 3, kind: 'follow', rigid: false },
  ...finger(5, 5),
  ...finger(10, 9),
  ...finger(15, 13),
  ...finger(20, 17),
];

/** Pulso, base do indicador, base do mínimo e base do médio (índices das articulações). */
const PALM_JOINTS = [0, 6, 21, 11] as const;
/** Os mesmos pontos nos landmarks do MediaPipe. */
const PALM_LANDMARKS = [0, 5, 17, 9] as const;

export interface Rest {
  pos: Vector3[];
  quat: Quaternion[];
  /** Direção do osso (até a articulação seguinte) no referencial da própria articulação. */
  dirLocal: Vector3[];
  len: number[];
  /** Rotação da palma em repouso (referencial da palma -> espaço do modelo). */
  palm: Quaternion;
}

/** Referencial da palma: y do pulso para a base do médio, x do mínimo para o indicador. */
function palmFrame(w: Vector3, index: Vector3, pinky: Vector3, middle: Vector3): Quaternion {
  const y = middle.clone().sub(w).normalize();
  const x = index.clone().sub(pinky);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function makeRest(pos: Vector3[], quat: Quaternion[]): Rest {
  const dirLocal: Vector3[] = [];
  const len: number[] = [];
  JOINTS.forEach((_, j) => {
    // A articulação seguinte é sempre j + 1 (no pulso e nas pontas o valor não é usado)
    const next = j + 1 < JOINTS.length && SPECS[j + 1].parent === j ? j + 1 : -1;
    if (next < 0) {
      dirLocal.push(new Vector3(0, 0, -1));
      len.push(0);
      return;
    }
    const d = pos[next].clone().sub(pos[j]);
    len.push(d.length());
    dirLocal.push(d.normalize().applyQuaternion(quat[j].clone().invert()));
  });
  const [w, i, p, m] = PALM_JOINTS.map((k) => pos[k]);
  return { pos, quat, dirLocal, len, palm: palmFrame(w, i, p, m) };
}

/** Rotações (espaço do modelo) das 25 articulações para os 21 landmarks (já no espaço da cena). */
export function retarget(rest: Rest, lm: readonly Vector3[]): Quaternion[] {
  const [w, i, p, m] = PALM_LANDMARKS.map((k) => lm[k]);
  const palm = palmFrame(w, i, p, m).multiply(rest.palm.clone().invert());
  const out: Quaternion[] = [];
  const target = new Vector3();
  const current = new Vector3();
  const local = new Vector3();
  const X = new Vector3(1, 0, 0);
  const Y = new Vector3(0, 1, 0);
  SPECS.forEach((s, j) => {
    let q: Quaternion;
    if (s.parent < 0) {
      q = palm.clone().multiply(rest.quat[j]);
    } else {
      // Parte da rotação do pai, mantendo a relação de repouso entre os dois
      q = out[s.parent].clone().multiply(rest.quat[s.parent].clone().invert()).multiply(rest.quat[j]);
      if (s.kind === 'aim' && s.dir) {
        target.subVectors(lm[s.dir[1]], lm[s.dir[0]]);
        if (target.lengthSq() > 1e-10) {
          target.normalize();
          // Alinha primeiro o eixo de repouso do osso com -Z (os ossos do modelo quase já estão)
          q.multiply(new Quaternion().setFromUnitVectors(rest.dirLocal[j], new Vector3(0, 0, -1)));
          if (s.limit) {
            // Direção desejada no referencial da articulação: dobra (em X) e abertura (em Y)
            local.copy(target).applyQuaternion(q.clone().invert());
            if (s.limit === 'hinge') {
              const flex = clamp(Math.atan2(-local.y, -local.z), HINGE);
              q.multiply(new Quaternion().setFromAxisAngle(X, -flex));
            } else {
              // Dobra no plano YZ (faixa inteira) e abertura para os lados em cima dela
              const flex = clamp(Math.atan2(-local.y, -local.z), BASE_FLEX);
              const spread = clamp(Math.atan2(-local.x, Math.hypot(local.y, local.z)), [-BASE_SPREAD, BASE_SPREAD]);
              q.multiply(new Quaternion().setFromAxisAngle(X, -flex)).multiply(new Quaternion().setFromAxisAngle(Y, spread));
            }
          } else {
            current.set(0, 0, -1).applyQuaternion(q);
            q.premultiply(new Quaternion().setFromUnitVectors(current, target));
          }
          // Volta ao eixo de repouso do osso
          q.multiply(new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), rest.dirLocal[j]));
        }
      }
    }
    out.push(q);
  });
  return out;
}

/**
 * Posições das articulações a partir das rotações, com os comprimentos do modelo. stretch
 * (opcional, por articulação) alonga o osso que sai dela.
 */
export function positions(rest: Rest, q: readonly Quaternion[], stretch?: readonly number[], origin = new Vector3()): Vector3[] {
  const out: Vector3[] = [];
  const delta = q[0].clone().multiply(rest.quat[0].clone().invert());
  SPECS.forEach((s, j) => {
    if (s.rigid) {
      out.push(rest.pos[j].clone().sub(rest.pos[0]).applyQuaternion(delta).add(origin));
    } else {
      const k = s.parent;
      out.push(rest.dirLocal[k].clone().applyQuaternion(q[k]).multiplyScalar(rest.len[k] * (stretch?.[k] ?? 1)).add(out[k]));
    }
  });
  return out;
}

/** Mistura de duas poses (rotações), t de 0 a 1. */
export function slerpPose(a: readonly Quaternion[], b: readonly Quaternion[], t: number, out: Quaternion[] = []): Quaternion[] {
  a.forEach((qa, j) => {
    out[j] = (out[j] ?? new Quaternion()).copy(qa).slerp(b[j], t);
  });
  return out;
}
