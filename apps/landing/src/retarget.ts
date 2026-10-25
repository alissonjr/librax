/*
 * Retargeting dos 21 landmarks do MediaPipe para o esqueleto da mão 3D do protótipo
 * (src/mao-3d.glb, gerado por scripts/mao3d/gerar.py; usado por src/mao3d.ts).
 *
 * O esqueleto tem um osso por segmento do MediaPipe: pulso, um metacarpo por dedo (a palma
 * fecha um pouco em concha), polegar CMC/MCP/IP e MCP/PIP/DIP de cada dedo, mais as pontas.
 * Cada osso tem +Y ao longo do osso e +Z para o lado da unha; em repouso a mão está aberta,
 * com os dedos retos, a palma virada para +Z e os dedos para +Y.
 *
 * Cada pose vira um punhado de ângulos (HandPose), num referencial da palma (x para o lado do
 * polegar, y do pulso para os dedos, z para a frente da palma):
 * 1. Palma: referencial com pulso (0), base do indicador (5), do mínimo (17) e do médio (9); a
 *    rotação entre o dos dados e o do modelo gira a mão inteira.
 * 2. Metacarpos: abrem em leque conforme a posição das bases dos dedos e fecham em concha
 *    (anelar e mínimo mais) quando os dedos dobram.
 * 3. Dedos: cada dedo dobra num plano (dobradiça), com ângulos lidos dos dados e "conhecimento
 *    de mão": a profundidade do MediaPipe falha justamente nos dedos dobrados, então, se no
 *    plano da imagem a ponta do dedo cai sobre a palma, o dedo vai para a curva de punho
 *    fechado; se a parte de cima do dedo aparece encurtada na imagem (gancho do X), a junta do
 *    meio dobra o que falta; a ponta (DIP) acompanha a junta do meio (PIP) em cerca de 2/3; a
 *    abertura lateral na base é limitada e some quando o dedo dobra.
 * 4. Polegar: o metacarpo sai da base do modelo, aponta para o landmark 2 e gira em torno do próprio eixo para a polpa
 *    ficar virada para a base do indicador (plano polegar e indicador); MCP e IP dobram como
 *    dobradiças.
 *
 * Pele que não atravessa pele (solveCollisions, a cada quadro, depois da mistura entre duas
 * pessoas): cada falange é uma cápsula com a grossura do dedo e a palma é uma placa com as
 * almofadas. Onde duas cápsulas de dedos vizinhos (ou do polegar e de um dedo) se cruzam, ou um
 * dedo entra na palma, os ângulos que levaram até ali voltam um pouco (de preferência a abertura
 * lateral; na palma, a dobra das juntas da ponta), na medida da invasão, pela direção do contato
 * (jacobiano). O polegar preso entre um dedo dobrado e a palma sai pela frente. Até doze passadas
 * por quadro, parando quando a invasão some (em geral bastam duas a quatro); o punho fecha até
 * encostar na palma, sem entrar nela. Indicador e médio cruzados (R) se separam pela frente e
 * por trás, não pelos lados.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

export const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
export type Finger = (typeof FINGERS)[number];

/** Ossos do modelo, na ordem usada aqui. */
export const BONES = [
  'wrist',
  'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  ...FINGERS.flatMap((f) => [`${f}_meta`, `${f}_mcp`, `${f}_pip`, `${f}_dip`, `${f}_tip`]),
] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((b, i) => [b, i])) as Record<BoneName, number>;
export const BONE_INDEX = B;

/** Base de cada dedo nos landmarks. */
const LM: Record<Finger, number> = { index: 5, middle: 9, ring: 13, pinky: 17 };
/** Distância da ponta ao centro da palma na imagem, com o dedo esticado (média do B). */
const TIP_REACH: Record<Finger, number> = { index: 1.06, middle: 1.17, ring: 1.05, pinky: 0.8 };

/**
 * Meia grossura das falanges (base, PIP, DIP, ponta), a mesma da malha (scripts/mao3d/anatomia.py),
 * um pouco menor: a pele cede um pouco no contato.
 */
const SKIN = 0.95;
const RADII: Record<Finger | 'thumb', readonly number[]> = {
  index: [0.097, 0.087, 0.077, 0.067],
  middle: [0.1, 0.09, 0.079, 0.069],
  ring: [0.093, 0.083, 0.073, 0.064],
  pinky: [0.082, 0.072, 0.064, 0.057],
  thumb: [0.118, 0.106, 0.096, 0.08],
};

/** Limites em radianos. Dobra: positivo fecha para a palma. */
const MCP_FLEX: readonly [number, number] = [-0.35, 1.62];
const PIP_FLEX: readonly [number, number] = [-0.05, 1.95];
const DIP_FLEX: readonly [number, number] = [-0.12, 1.3];
const SPREAD: Record<Finger, number> = { index: 0.3, middle: 0.18, ring: 0.2, pinky: 0.34 };
const FAN: Record<Finger, number> = { index: 0.06, middle: 0.03, ring: 0.07, pinky: 0.13 };
/** Concha da palma: quanto cada metacarpo pode fechar para a frente. */
const CUP: Record<Finger, readonly [number, number]> = {
  index: [-0.02, 0.03], middle: [-0.01, 0.02], ring: [-0.04, 0.13], pinky: [-0.06, 0.26],
};
/** Curva de punho fechado (MCP, PIP, DIP): apertada; a colisão com a palma segura a ponta. */
const FIST = [1.5, 1.75, 0.92] as const;
/** Quanto a DIP segue 2/3 da PIP (o resto vem dos dados). */
const DIP_COUPLING = 0.7;
const THUMB_TWIST = 1.25;
const THUMB_MCP_FLEX: readonly [number, number] = [-0.4, 1.25];
const THUMB_MCP_ABD = 0.3;
const THUMB_IP_FLEX: readonly [number, number] = [-0.35, 1.45];
const THUMB_LIFT = 1.0;

const clamp = (v: number, [a, b]: readonly [number, number]) => Math.min(b, Math.max(a, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const axisAngle = (axis: Vector3, angle: number) => new Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

export interface RigNode {
  name: string;
  position: Vector3;
  quaternion: Quaternion;
}

export interface Rig {
  parent: number[];
  localPos: Vector3[];
  localQuat: Quaternion[];
  /** Repouso no espaço do modelo (o do pai do pulso). */
  worldPos: Vector3[];
  worldQuat: Quaternion[];
  /** Referencial da palma em repouso (palma -> modelo). */
  palm: Quaternion;
  /** Posições de repouso no referencial da palma, com a palma de comprimento 1. */
  local: Vector3[];
  palmLen: number;
  /** Eixos de repouso no referencial da palma: direção de cada dedo e dobradiça. */
  fingerDir: Record<Finger, Vector3>;
  hinge: Record<Finger, Vector3>;
  thumbDir: Vector3;
  thumbPad: Vector3;
  thumbSide: Vector3;
  /** Comprimentos das falanges (proximal, média, distal) de cada dedo. */
  lengths: Record<Finger, [number, number, number]>;
}

/** Pose como ângulos (o que se mistura entre duas pessoas). */
export interface HandPose {
  /** Rotação da mão inteira (palma do modelo -> palma dos dados). */
  hand: Quaternion;
  fan: number[];
  cup: number[];
  spread: number[];
  /** Dobra de MCP, PIP e DIP de cada dedo. */
  flex: number[][];
  /** Rotação do metacarpo do polegar, no referencial da palma. */
  thumb: Quaternion;
  /** Ajuste do metacarpo do polegar pela colisão (em volta de x e de y da palma). */
  thumbLift: [number, number];
  thumbMcp: [number, number];
  thumbIp: number;
  /**
   * Indicador e médio cruzados (R): de 0 a 1, e de que lado o indicador passa (+1 na frente da
   * palma, -1 atrás). Cruzados, os dois se separam pela frente e por trás, não pelos lados.
   */
  cross: number;
  crossSide: number;
}

const PARENT: Record<BoneName, BoneName | null> = Object.fromEntries(
  BONES.map((b) => {
    if (b === 'wrist') return [b, null];
    const [digit, part] = b.split('_');
    const chain = digit === 'thumb' ? ['cmc', 'mcp', 'ip', 'tip'] : ['meta', 'mcp', 'pip', 'dip', 'tip'];
    const k = chain.indexOf(part);
    return [b, k === 0 ? 'wrist' : `${digit}_${chain[k - 1]}`];
  }),
) as Record<BoneName, BoneName | null>;

/** Referencial da palma: y do pulso para a base do médio, x do mínimo para o indicador, z para a frente. */
function palmFrame(w: Vector3, index: Vector3, pinky: Vector3, middle: Vector3): Quaternion {
  const y = middle.clone().sub(w).normalize();
  const x = index.clone().sub(pinky);
  x.addScaledVector(y, -x.dot(y)).normalize();
  const z = new Vector3().crossVectors(x, y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export function forward(parent: readonly number[], localPos: readonly Vector3[], localQuat: readonly Quaternion[]) {
  const pos: Vector3[] = [];
  const quat: Quaternion[] = [];
  localQuat.forEach((q, j) => {
    const p = parent[j];
    if (p < 0) {
      pos.push(localPos[j].clone());
      quat.push(q.clone());
    } else {
      pos.push(localPos[j].clone().applyQuaternion(quat[p]).add(pos[p]));
      quat.push(quat[p].clone().multiply(q));
    }
  });
  return { pos, quat };
}

/** Monta o esqueleto a partir dos nós do modelo (posição e rotação locais de cada osso). */
export function makeRig(nodes: readonly RigNode[]): Rig {
  const byName = new Map(nodes.map((n) => [n.name, n]));
  const missing = BONES.filter((b) => !byName.has(b));
  if (missing.length) throw new Error(`esqueleto sem ${missing.join(', ')}`);
  const parent = BONES.map((b) => (PARENT[b] ? B[PARENT[b]!] : -1));
  const localPos = BONES.map((b) => byName.get(b)!.position.clone());
  const localQuat = BONES.map((b) => byName.get(b)!.quaternion.clone());
  const { pos, quat } = forward(parent, localPos, localQuat);
  const palm = palmFrame(pos[B.wrist], pos[B.index_mcp], pos[B.pinky_mcp], pos[B.middle_mcp]);
  const palmLen = pos[B.middle_mcp].distanceTo(pos[B.wrist]);
  const inv = palm.clone().invert();
  const local = pos.map((p) => p.clone().sub(pos[B.wrist]).applyQuaternion(inv).divideScalar(palmLen));
  const fingerDir = {} as Record<Finger, Vector3>;
  const hinge = {} as Record<Finger, Vector3>;
  const lengths = {} as Record<Finger, [number, number, number]>;
  for (const f of FINGERS) {
    fingerDir[f] = local[B[`${f}_pip`]].clone().sub(local[B[`${f}_mcp`]]).normalize();
    hinge[f] = new Vector3().crossVectors(fingerDir[f], Z).normalize();
    const seg = (a: BoneName, b: BoneName) => local[B[b]].distanceTo(local[B[a]]);
    lengths[f] = [seg(`${f}_mcp`, `${f}_pip`), seg(`${f}_pip`, `${f}_dip`), seg(`${f}_dip`, `${f}_tip`)];
  }
  const thumbDir = local[B.thumb_mcp].clone().sub(local[B.thumb_cmc]).normalize();
  const thumbPad = new Vector3(0, 0, -1).applyQuaternion(quat[B.thumb_cmc]).applyQuaternion(inv);
  thumbPad.addScaledVector(thumbDir, -thumbPad.dot(thumbDir)).normalize();
  const thumbSide = new Vector3().crossVectors(thumbDir, thumbPad).normalize();
  return {
    parent, localPos, localQuat, worldPos: pos, worldQuat: quat, palm, local, palmLen,
    fingerDir, hinge, thumbDir, thumbPad, thumbSide, lengths,
  };
}

export interface Detail {
  /** Dedos tratados como dobrados pela regra da imagem (0 a 1). */
  fold: Record<Finger, number>;
  /** Ângulos (MCP, PIP, DIP) e abertura de cada dedo, antes da colisão. */
  angles: Record<Finger, [number, number, number, number]>;
  thumbTwist: number;
}

/** PIP que explica a parte de cima do dedo encurtada na imagem (DIP = 2/3 da PIP). */
function flexFromShortening(l2: number, l3: number, ratio: number): number {
  const target = Math.min(1, ratio);
  const f = (t: number) => (l2 * Math.cos(t) + l3 * Math.cos((5 * t) / 3)) / (l2 + l3);
  let lo = 0;
  let hi = 1.5;
  if (f(0) <= target) return 0;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Pose (ângulos) para os 21 landmarks (já no espaço da cena: x para a direita, y para cima, z para
 * quem olha). detail, se vier, recebe os ângulos (para testes e ajuste).
 */
export function retarget(rig: Rig, lm: readonly Vector3[], detail?: Partial<Detail>): HandPose {
  const dataPalm = palmFrame(lm[0], lm[5], lm[17], lm[9]);
  const inv = dataPalm.clone().invert();
  const scale = lm[9].distanceTo(lm[0]) || 1;
  // Landmarks no referencial da palma
  const L = lm.map((p) => p.clone().sub(lm[0]).applyQuaternion(inv).divideScalar(scale));
  const M = rig.local;

  const c2 = [0, 5, 9, 13, 17].reduce((acc, i) => acc.add(new Vector3(lm[i].x, lm[i].y, 0)), new Vector3()).divideScalar(5);
  const len2 = (a: number, b: number) => Math.hypot(lm[b].x - lm[a].x, lm[b].y - lm[a].y);
  const palm2d = len2(0, 9) || 1;
  const fold = {} as Record<Finger, number>;
  const angles = {} as Record<Finger, [number, number, number, number]>;
  const pose: HandPose = {
    hand: dataPalm.clone().multiply(rig.palm.clone().invert()),
    fan: [], cup: [], spread: [], flex: [],
    thumb: new Quaternion(), thumbLift: [0, 0], thumbMcp: [0, 0], thumbIp: 0,
    // Cruzados: as pontas trocam de lado em relação às bases
    cross: smooth(0.0, 0.08, (L[12].x - L[8].x) * Math.sign(L[5].x - L[9].x || 1)),
    crossSide: L[7].z + L[8].z >= L[11].z + L[12].z ? 1 : -1,
  };
  const curl: number[] = [];
  // Cruzados (R): o indicador pode ir bem mais para o lado do médio
  const crossLimit = SPREAD.index + 0.3 * pose.cross;

  FINGERS.forEach((f, fi) => {
    // Metacarpo: leque
    const base = M[B[`${f}_meta`]];
    const dm = M[B[`${f}_mcp`]].clone().sub(base);
    const dd = L[LM[f]].clone().sub(base);
    const fan = clamp(wrap(Math.atan2(dd.x, dd.y) - Math.atan2(dm.x, dm.y)), [-FAN[f], FAN[f]]);
    pose.fan[fi] = fan;
    const toMeta = axisAngle(Z, -fan).invert();

    const a = LM[f];
    const d = [1, 2, 3].map((k) => L[a + k].clone().sub(L[a + k - 1]).applyQuaternion(toMeta));
    const rest = rig.fingerDir[f];
    const restIn = Math.atan2(rest.x, rest.y);
    const restOut = Math.atan2(rest.z, Math.hypot(rest.x, rest.y));
    // Abertura lateral: só com o dedo esticado o bastante para ela ser lida no plano da palma
    const inPlane = Math.hypot(d[0].x, d[0].y) / (d[0].length() || 1);
    const lim = f === 'index' ? crossLimit : SPREAD[f];
    const spread = clamp(wrap(-(Math.atan2(d[0].x, d[0].y) - restIn)) * smooth(0.35, 0.85, inPlane), [-SPREAD[f], lim]);
    const dirIn = restIn - spread;
    const u = new Vector3(Math.sin(dirIn), Math.cos(dirIn), 0);
    const alpha = d.map((v) => Math.atan2(v.dot(Z), v.dot(u)));
    let t1 = alpha[0] - restOut;
    let t2 = wrap(alpha[1] - alpha[0]);
    let t3 = wrap(alpha[2] - alpha[1]);
    // Gancho: a parte de cima do dedo encurtada na imagem em relação à falange proximal
    const [l1, l2, l3] = rig.lengths[f];
    const prox = len2(a, a + 1);
    if (prox > 0.12 * palm2d) {
      const ratio = len2(a + 1, a + 3) / prox / ((l2 + l3) / l1);
      t2 = Math.max(t2, flexFromShortening(l2, l3, ratio / 0.95));
    }
    t3 = t3 + (0.67 * t2 - t3) * DIP_COUPLING;
    // Dedo dobrado na imagem: a ponta cai sobre a palma
    const tip = lm[a + 3];
    const near = Math.hypot(tip.x - c2.x, tip.y - c2.y) / palm2d / TIP_REACH[f];
    const s = smooth(0.75, 0.45, near) * smooth(0.25, 0.0, L[a + 3].y - L[a].y);
    fold[f] = s;
    t1 = Math.max(t1, t1 + (FIST[0] - t1) * s);
    t2 = t2 + (FIST[1] - t2) * s;
    t3 = t3 + (FIST[2] - t3) * s;
    t1 = clamp(t1, MCP_FLEX);
    t2 = clamp(t2, PIP_FLEX);
    t3 = clamp(t3, DIP_FLEX);
    angles[f] = [t1, t2, t3, spread];
    pose.spread[fi] = spread;
    pose.flex[fi] = [t1, t2, t3];
    curl.push(smooth(0.2, 2.6, t1 + t2));
  });

  // Concha da palma: um pouco pelos dados (base do mínimo à frente), mais pela dobra dos dedos
  const meanCurl = curl.reduce((s, v) => s + v, 0) / curl.length;
  const arch = Math.atan2(L[17].z - L[9].z, 0.45);
  FINGERS.forEach((f, k) => {
    const [lo, hi] = CUP[f];
    pose.cup[k] = clamp((0.35 * arch + 0.22 * meanCurl + 0.1 * curl[k]) * (hi / CUP.pinky[1]), [lo, hi]);
  });

  // ---------- polegar ----------
  const tRest = rig.thumbDir;
  const padRest = rig.thumbPad;
  const side = rig.thumbSide;
  // O landmark 1 (CMC) do MediaPipe sai mais para fora e para a frente que a articulação de
  // verdade: o metacarpo parte da base do modelo e aponta para a base do polegar dos dados (2)
  const t1 = L[2].clone().sub(M[B.thumb_cmc]).normalize();
  const aim = new Quaternion().setFromUnitVectors(tRest, t1);
  // Polpa virada para a base do indicador (plano polegar e indicador)
  const target = L[5].clone().add(L[6]).multiplyScalar(0.5).sub(L[2]);
  target.addScaledVector(t1, -target.dot(t1));
  let twist = 0;
  if (target.lengthSq() > 1e-6) {
    const pad = padRest.clone().applyQuaternion(aim);
    target.normalize();
    twist = clamp(Math.atan2(new Vector3().crossVectors(pad, target).dot(t1), pad.dot(target)), [-THUMB_TWIST, THUMB_TWIST]);
  }
  pose.thumb = axisAngle(t1, twist).multiply(aim);
  const toThumb = pose.thumb.clone().invert();
  const t2 = L[3].clone().sub(L[2]).normalize().applyQuaternion(toThumb);
  const flex2 = clamp(Math.atan2(t2.dot(padRest), t2.dot(tRest)), THUMB_MCP_FLEX);
  const abd2 = clamp(Math.atan2(t2.dot(side), Math.hypot(t2.dot(padRest), t2.dot(tRest))), [-THUMB_MCP_ABD, THUMB_MCP_ABD]);
  const rMcp = axisAngle(padRest, -abd2).multiply(axisAngle(side, flex2));
  const t3 = L[4].clone().sub(L[3]).normalize().applyQuaternion(rMcp.clone().invert().multiply(toThumb));
  pose.thumbMcp = [flex2, abd2];
  pose.thumbIp = clamp(Math.atan2(t3.dot(padRest), t3.dot(tRest)), THUMB_IP_FLEX);

  if (detail) {
    detail.fold = fold;
    detail.angles = angles;
    detail.thumbTwist = twist;
  }
  return pose;
}

// --------------------------------------------------------------------------- //
// Pose -> rotações locais
// --------------------------------------------------------------------------- //
interface Built {
  local: Quaternion[];
  pos: Vector3[];
  /** Rotação acumulada (referencial da palma) de cada osso. */
  acc: Quaternion[];
  /** Palma -> modelo, com a mão girada (G). */
  G: Quaternion;
}

/** Rotações (referencial da palma, relativas ao repouso) de cada osso. */
function boneRotations(rig: Rig, pose: HandPose): Quaternion[] {
  const R: Quaternion[] = BONES.map(() => new Quaternion());
  FINGERS.forEach((f, k) => {
    const base = rig.local[B[`${f}_meta`]];
    const dir = rig.local[B[`${f}_mcp`]].clone().sub(base).normalize();
    const cupAxis = new Vector3().crossVectors(dir, Z).normalize();
    R[B[`${f}_meta`]] = axisAngle(cupAxis, pose.cup[k]).multiply(axisAngle(Z, -pose.fan[k]));
    const h = rig.hinge[f];
    const [t1, t2, t3] = pose.flex[k];
    R[B[`${f}_mcp`]] = axisAngle(Z, pose.spread[k]).multiply(axisAngle(h, t1));
    R[B[`${f}_pip`]] = axisAngle(h, t2);
    R[B[`${f}_dip`]] = axisAngle(h, t3);
  });
  R[B.thumb_cmc] = axisAngle(X, pose.thumbLift[0]).multiply(axisAngle(Y, pose.thumbLift[1])).multiply(pose.thumb);
  R[B.thumb_mcp] = axisAngle(rig.thumbPad, -pose.thumbMcp[1]).multiply(axisAngle(rig.thumbSide, pose.thumbMcp[0]));
  R[B.thumb_ip] = axisAngle(rig.thumbSide, pose.thumbIp);
  return R;
}

function build(rig: Rig, pose: HandPose): Built {
  const R = boneRotations(rig, pose);
  // mundo_j = mão * palmaModelo * Racum_j * palmaModelo^-1 * repouso_j
  const G = pose.hand.clone().multiply(rig.palm);
  const Ginv = rig.palm.clone().invert();
  const acc: Quaternion[] = [];
  const world: Quaternion[] = [];
  const local: Quaternion[] = [];
  const pos: Vector3[] = [];
  BONES.forEach((_, j) => {
    const p = rig.parent[j];
    acc.push(p < 0 ? R[j].clone() : acc[p].clone().multiply(R[j]));
    const w = G.clone().multiply(acc[j]).multiply(Ginv).multiply(rig.worldQuat[j]);
    world.push(w);
    local.push(p < 0 ? w : world[p].clone().invert().multiply(w));
    pos.push(p < 0 ? rig.localPos[j].clone() : rig.localPos[j].clone().applyQuaternion(world[p]).add(pos[p]));
  });
  return { local, pos, acc, G };
}

/** Rotações locais dos ossos para uma pose. */
export function toLocal(rig: Rig, pose: HandPose): Quaternion[] {
  return build(rig, pose).local;
}

/** Posições (espaço do modelo) dos ossos para rotações locais. */
export function positions(rig: Rig, local: readonly Quaternion[]): Vector3[] {
  return forward(rig.parent, rig.localPos, local).pos;
}

export function clonePose(p: HandPose): HandPose {
  return {
    hand: p.hand.clone(), fan: [...p.fan], cup: [...p.cup], spread: [...p.spread], flex: p.flex.map((f) => [...f]),
    thumb: p.thumb.clone(), thumbLift: [...p.thumbLift], thumbMcp: [...p.thumbMcp], thumbIp: p.thumbIp,
    cross: p.cross, crossSide: p.crossSide,
  };
}

/** Mistura de duas poses (ângulos e rotações), t de 0 a 1. */
export function mixPose(a: HandPose, b: HandPose, t: number): HandPose {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    hand: a.hand.clone().slerp(b.hand, t),
    fan: a.fan.map((v, k) => l(v, b.fan[k])),
    cup: a.cup.map((v, k) => l(v, b.cup[k])),
    spread: a.spread.map((v, k) => l(v, b.spread[k])),
    flex: a.flex.map((f, k) => f.map((v, i) => l(v, b.flex[k][i]))),
    thumb: a.thumb.clone().slerp(b.thumb, t),
    thumbLift: [l(a.thumbLift[0], b.thumbLift[0]), l(a.thumbLift[1], b.thumbLift[1])],
    thumbMcp: [l(a.thumbMcp[0], b.thumbMcp[0]), l(a.thumbMcp[1], b.thumbMcp[1])],
    thumbIp: l(a.thumbIp, b.thumbIp),
    cross: l(a.cross, b.cross),
    crossSide: t < 0.5 ? a.crossSide : b.crossSide,
  };
}

// --------------------------------------------------------------------------- //
// Colisão: pele que não atravessa pele
// --------------------------------------------------------------------------- //
/** Um ângulo da pose que move um ponto: eixo (modelo), pivô e peso (preferência). */
interface Dof {
  get: () => number;
  set: (v: number) => void;
  axis: Vector3;
  pivot: Vector3;
  w: number;
}

interface Capsule {
  digit: number; // 0..3 dedos, 4 polegar
  seg: number;
  a: Vector3;
  b: Vector3;
  r: number;
}

const tmpA = new Vector3();
const tmpB = new Vector3();
const tmpC = new Vector3();

/** Pontos mais próximos entre dois segmentos (escreve em pa e pb). */
function closestSegments(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3, pa: Vector3, pb: Vector3): number {
  const d1 = tmpA.subVectors(q1, p1);
  const d2 = tmpB.subVectors(q2, p2);
  const r = tmpC.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  const c = d1.dot(r);
  const b = d1.dot(d2);
  const den = a * e - b * b;
  let s = den > 1e-9 ? clamp((b * f - c * e) / den, [0, 1]) : 0;
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp(-c / a, [0, 1]);
  } else if (t > 1) {
    t = 1;
    s = clamp((b - c) / a, [0, 1]);
  }
  pa.copy(p1).addScaledVector(d1, s);
  pb.copy(p2).addScaledVector(d2, t);
  return pa.distanceTo(pb);
}

/** Altura da superfície da palma (lado da frente) no referencial da palma, com as almofadas. */
function palmSurface(x: number, y: number): number {
  return (
    0.106 +
    0.085 * Math.exp(-((x - 0.2) ** 2) / 0.03 - ((y - 0.36) ** 2) / 0.06) +
    0.05 * Math.exp(-((x + 0.31) ** 2) / 0.02 - ((y - 0.38) ** 2) / 0.08) +
    0.025 * Math.exp(-((y - 0.87) ** 2) / 0.006)
  );
}

/** Pesos na colisão com a palma, pelos pesos normais (abertura, MCP, PIP, DIP). */
const PALM_W = new Map([[1, 0.05], [0.55, 0.3], [0.4, 0.55], [0.3, 0.7]]);

export interface CollisionStats {
  contacts: number;
  /** Maior invasão restante (unidades de palma). */
  depth: number;
  /** Onde fica a maior invasão restante (para ajuste). */
  worst?: string;
}

interface Contact {
  c: Capsule;
  p: Vector3;
  n: Vector3;
  depth: number;
  other?: { c: Capsule; p: Vector3 };
}

/**
 * Tira a pele de dentro da pele: ajusta os ângulos da pose (no lugar) até as falanges não se
 * cruzarem e não entrarem na palma. Devolve as rotações locais já resolvidas.
 */
export function solveCollisions(rig: Rig, pose: HandPose, iterations = 12, stats?: CollisionStats): Quaternion[] {
  let built = build(rig, pose);
  const pa = new Vector3();
  const pb = new Vector3();
  const cross = new Vector3();
  const v = new Vector3();
  let contacts = 0;
  let depth = 0;
  for (let it = 0; it <= iterations; it++) {
    const { pos, acc, G } = built;
    const toWorld = (q: Quaternion, axis: Vector3) => axis.clone().applyQuaternion(q).applyQuaternion(G);
    const caps: Capsule[] = [];
    const dofs: Dof[][][] = []; // [dígito][segmento] -> ângulos que movem esse segmento
    FINGERS.forEach((f, k) => {
      const chain = [B[`${f}_mcp`], B[`${f}_pip`], B[`${f}_dip`], B[`${f}_tip`]];
      const r = RADII[f];
      const meta = acc[B[`${f}_meta`]];
      const afterSpread = meta.clone().multiply(axisAngle(Z, pose.spread[k]));
      const spread: Dof = {
        get: () => pose.spread[k],
        set: (x) => (pose.spread[k] = clamp(x, [-SPREAD[f] * 1.6, SPREAD[f] * 1.6 + (k === 0 ? 0.3 * pose.cross : 0)])),
        axis: toWorld(meta, Z),
        pivot: pos[chain[0]],
        w: 1,
      };
      const lim = [MCP_FLEX, PIP_FLEX, DIP_FLEX];
      const flex: Dof[] = [0, 1, 2].map((i) => ({
        get: () => pose.flex[k][i],
        set: (x: number) => (pose.flex[k][i] = clamp(x, lim[i])),
        axis: toWorld(i === 0 ? afterSpread : acc[chain[i - 1]], rig.hinge[f]),
        pivot: pos[chain[i]],
        w: [0.55, 0.4, 0.3][i],
      }));
      dofs[k] = [0, 1, 2].map((s) => [spread, ...flex.slice(0, s + 1)]);
      for (let s = 0; s < 3; s++) {
        caps.push({ digit: k, seg: s, a: pos[chain[s]], b: pos[chain[s + 1]], r: ((r[s] + r[s + 1]) / 2) * SKIN * rig.palmLen });
      }
    });
    {
      const chain = [B.thumb_cmc, B.thumb_mcp, B.thumb_ip, B.thumb_tip];
      const r = RADII.thumb;
      const liftX: Dof = {
        get: () => pose.thumbLift[0],
        set: (x) => (pose.thumbLift[0] = clamp(x, [-THUMB_LIFT, THUMB_LIFT])),
        axis: toWorld(new Quaternion(), X),
        pivot: pos[chain[0]],
        w: 0.7,
      };
      const liftY: Dof = {
        get: () => pose.thumbLift[1],
        set: (x) => (pose.thumbLift[1] = clamp(x, [-THUMB_LIFT, THUMB_LIFT])),
        axis: toWorld(axisAngle(X, pose.thumbLift[0]), Y),
        pivot: pos[chain[0]],
        w: 0.7,
      };
      const mcpQ = acc[B.thumb_cmc].clone().multiply(axisAngle(rig.thumbPad, -pose.thumbMcp[1]));
      const mcp: Dof = {
        get: () => pose.thumbMcp[0],
        set: (x) => (pose.thumbMcp[0] = clamp(x, THUMB_MCP_FLEX)),
        axis: toWorld(mcpQ, rig.thumbSide),
        pivot: pos[chain[1]],
        w: 0.5,
      };
      const ip: Dof = {
        get: () => pose.thumbIp,
        set: (x) => (pose.thumbIp = clamp(x, THUMB_IP_FLEX)),
        axis: toWorld(acc[B.thumb_mcp], rig.thumbSide),
        pivot: pos[chain[2]],
        w: 0.4,
      };
      dofs[4] = [[liftX, liftY], [liftX, liftY, mcp], [liftX, liftY, mcp, ip]];
      for (let s = 0; s < 3; s++) {
        caps.push({ digit: 4, seg: s, a: pos[chain[s]], b: pos[chain[s + 1]], r: ((r[s] + r[s + 1]) / 2) * SKIN * rig.palmLen });
      }
    }

    const found: Contact[] = [];
    for (let i = 0; i < caps.length; i++) {
      for (let j = i + 1; j < caps.length; j++) {
        const A = caps[i];
        const C = caps[j];
        if (A.digit === C.digit) continue;
        // Dedos vizinhos, e polegar com qualquer dedo (o metacarpo do polegar fica dentro da palma)
        const thumb = A.digit === 4 || C.digit === 4;
        if (!thumb && Math.abs(A.digit - C.digit) !== 1) continue;
        if (thumb && (A.digit === 4 ? A.seg : C.seg) === 0) continue;
        const d = closestSegments(A.a, A.b, C.a, C.b, pa, pb);
        const want = A.r + C.r;
        if (d >= want) continue;
        let nn = d > 1e-6 ? pa.clone().sub(pb).divideScalar(d) : X.clone().multiplyScalar(A.digit < C.digit ? 1 : -1).applyQuaternion(G);
        // Indicador e médio cruzados: um passa na frente do outro
        if (pose.cross > 0.5 && A.digit === 0 && C.digit === 1) nn = Z.clone().multiplyScalar(pose.crossSide).applyQuaternion(G);
        // Polegar preso entre um dedo dobrado e a palma: ele sai pela frente, não para dentro
        if (thumb) {
          const front = Z.clone().applyQuaternion(G).multiplyScalar(C.digit === 4 ? -1 : 1);
          if (nn.dot(front) < 0.3) nn.addScaledVector(front, 0.8).normalize();
        }
        found.push({ c: A, p: pa.clone(), n: nn, depth: want - d, other: { c: C, p: pb.clone() } });
      }
    }
    // Palma: falanges do meio e da ponta (e o polegar) contra a placa da palma
    const Ginv = G.clone().invert();
    const wrist = pos[B.wrist];
    const palmN = Z.clone().applyQuaternion(G);
    for (const c of caps) {
      // Falange proximal dos dedos e metacarpo do polegar nascem na palma: ficam de fora
      if (c.seg === 0) continue;
      for (const t of c.digit === 4 && c.seg === 1 ? [0.5, 1] : [0, 0.5, 1]) {
        const p = c.a.clone().lerp(c.b, t);
        const q = p.clone().sub(wrist).applyQuaternion(Ginv).divideScalar(rig.palmLen);
        if (q.y < 0.02 || q.y > 1.0 || q.x < -0.5 || q.x > 0.4 || q.z < -0.06) continue;
        const pen = palmSurface(q.x, q.y) + c.r / rig.palmLen - q.z;
        if (pen > 0) found.push({ c, p, n: palmN, depth: pen * rig.palmLen });
      }
    }
    if (it === 0) contacts = found.length;
    depth = 0;
    for (const f of found) {
      if (f.depth <= depth) continue;
      depth = f.depth;
      if (stats) stats.worst = `${f.c.digit}.${f.c.seg}${f.other ? ` x ${f.other.c.digit}.${f.other.c.seg}` : ' x palma'}`;
    }
    // Invasão abaixo de meio por cento da palma já não aparece na pele
    if (it === iterations || depth < 0.005 * rig.palmLen) break;

    // Um passo por par (o contato mais fundo entre dois dedos, ou de um dedo com a palma), para não
    // corrigir a mesma invasão várias vezes: ângulos que afastam o ponto na direção da normal
    const deepest = new Map<string, Contact>();
    for (const f of found) {
      const key = f.other ? `${f.c.digit}-${f.other.c.digit}` : `${f.c.digit}-palma`;
      if ((deepest.get(key)?.depth ?? -1) < f.depth) deepest.set(key, f);
    }
    for (const f of deepest.values()) {
      const sides: [Dof[], Vector3, number][] = [[dofs[f.c.digit][f.c.seg], f.p, 1]];
      if (f.other) sides.push([dofs[f.other.c.digit][f.other.c.seg], f.other.p, -1]);
      const rows: [Dof, number][] = [];
      let sum = 0;
      for (const [list, p, sign] of sides) {
        for (const dof of list) {
          v.subVectors(p, dof.pivot);
          const g = sign * cross.crossVectors(dof.axis, v).dot(f.n);
          // Na palma, quem resolve é a dobra (a abertura lateral não tira o dedo de dentro), de
          // preferência das juntas da ponta: o punho continua fechado, encostado na palma
          const w = f.other ? dof.w : (PALM_W.get(dof.w) ?? dof.w);
          rows.push([dof, w * g]);
          sum += w * g * g;
        }
      }
      if (sum < 1e-8) continue;
      const k = (f.depth * 1.05) / sum;
      for (const [dof, wg] of rows) dof.set(dof.get() + Math.max(-0.25, Math.min(0.25, wg * k)));
    }
    built = build(rig, pose);
  }
  if (stats) {
    stats.contacts = contacts;
    stats.depth = depth;
  }
  return built.local;
}
