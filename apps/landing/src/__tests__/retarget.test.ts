import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import {
  BONES, BONE_INDEX as B, FINGERS, clonePose, makeRig, mixPose, positions, retarget, solveCollisions, toLocal,
  type CollisionStats, type Detail,
} from '../retarget';
import maos from '../maos.json';
import maosZ from '../maos-z.json';

/** Ossos em repouso lidos direto do GLB (cabeçalho JSON do arquivo). */
function rigFromGlb() {
  const buf = readFileSync(resolve(__dirname, '../mao-3d.glb'));
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: { name?: string; translation?: number[]; rotation?: number[] }[];
  };
  return makeRig(
    gltf.nodes
      .filter((n) => n.name && (BONES as readonly string[]).includes(n.name))
      .map((n) => ({
        name: n.name!,
        position: new Vector3(...(n.translation ?? [0, 0, 0])),
        quaternion: new Quaternion(...(n.rotation ?? [0, 0, 0, 1])),
      })),
  );
}

const DEPTH = 1.8;
const letras = maos.letras as Record<string, { poses: number[][] }>;
function landmarks(letter: string, k: number): Vector3[] {
  const p = letras[letter].poses[k];
  const z = (maosZ.letras as Record<string, number[][]>)[letter][k];
  return Array.from({ length: 21 }, (_, i) => new Vector3(p[i * 2], -p[i * 2 + 1], -z[i] * DEPTH));
}

describe('mão 3D: modelo e retargeting', () => {
  const rig = rigFromGlb();

  it('o modelo tem um osso por segmento do MediaPipe, mais as pontas', () => {
    expect(rig.worldPos).toHaveLength(BONES.length);
    expect(rig.palmLen).toBeCloseTo(1, 2);
  });

  it('os ossos apontam (+Y) para o filho e têm +Z para o lado da unha', () => {
    const dorsal = new Vector3(0, 0, -1).applyQuaternion(rig.palm);
    for (const f of FINGERS) {
      for (const [a, b] of [['mcp', 'pip'], ['pip', 'dip'], ['dip', 'tip']] as const) {
        const j = B[`${f}_${a}`];
        const along = rig.worldPos[B[`${f}_${b}`]].clone().sub(rig.worldPos[j]).normalize();
        expect(new Vector3(0, 1, 0).applyQuaternion(rig.worldQuat[j]).dot(along)).toBeGreaterThan(0.999);
        expect(new Vector3(0, 0, 1).applyQuaternion(rig.worldQuat[j]).dot(dorsal)).toBeGreaterThan(0.95);
      }
    }
  });

  it('a profundidade cobre as mesmas poses do maos.json', () => {
    for (const [L, info] of Object.entries(letras)) {
      expect((maosZ.letras as Record<string, number[][]>)[L]).toHaveLength(info.poses.length);
    }
  });

  it('a palma fica na mesma direção dos dados', () => {
    for (const L of Object.keys(letras)) {
      const lm = landmarks(L, 0);
      const pos = positions(rig, toLocal(rig, retarget(rig, lm)));
      const want = lm[9].clone().sub(lm[0]).normalize();
      const got = pos[B.middle_mcp].clone().sub(pos[B.wrist]).normalize();
      expect(got.dot(want), L).toBeGreaterThan(0.99);
    }
  });

  it('no A, os quatro dedos fecham em punho: pontas encostadas na palma', () => {
    for (let k = 0; k < letras.A.poses.length; k++) {
      const d: Partial<Detail> = {};
      const pose = retarget(rig, landmarks('A', k), d);
      const toPalm = pose.hand.clone().multiply(rig.palm).invert();
      const pos = positions(rig, solveCollisions(rig, clonePose(pose)));
      for (const f of FINGERS) {
        expect(d.fold![f], `A${k} ${f}`).toBeGreaterThan(0.5);
        // Ponta abaixo da base do dedo e logo na frente da palma (encostada, não dentro nem longe)
        const tip = pos[B[`${f}_tip`]].clone().sub(pos[B.wrist]).applyQuaternion(toPalm);
        const mcp = pos[B[`${f}_mcp`]].clone().sub(pos[B.wrist]).applyQuaternion(toPalm);
        expect(tip.y, `A${k} ${f}`).toBeLessThan(mcp.y);
        expect(tip.z, `A${k} ${f}`).toBeGreaterThan(0.1);
        expect(tip.z, `A${k} ${f}`).toBeLessThan(0.36);
      }
    }
  });

  it('no B, os quatro dedos ficam esticados', () => {
    for (let k = 0; k < letras.B.poses.length; k++) {
      const d: Partial<Detail> = {};
      retarget(rig, landmarks('B', k), d);
      for (const f of FINGERS) {
        expect(d.fold![f], `B${k} ${f}`).toBe(0);
        expect(d.angles![f][1], `B${k} ${f}`).toBeLessThan(0.6);
      }
    }
  });

  it('no I, só o mínimo fica de pé', () => {
    for (let k = 0; k < letras.I.poses.length; k++) {
      const d: Partial<Detail> = {};
      retarget(rig, landmarks('I', k), d);
      expect(d.fold!.pinky, `I${k}`).toBe(0);
      for (const f of ['index', 'middle', 'ring'] as const) expect(d.fold![f], `I${k} ${f}`).toBeGreaterThan(0.5);
    }
  });

  it('a ponta do dedo acompanha a junta do meio (cerca de 2/3) e a abertura lateral é limitada', () => {
    for (const L of Object.keys(letras)) {
      for (let k = 0; k < letras[L].poses.length; k++) {
        const d: Partial<Detail> = {};
        retarget(rig, landmarks(L, k), d);
        for (const f of FINGERS) {
          const [, pip, dip, spread] = d.angles![f];
          if (d.fold![f] === 0 && pip > 0.2 && pip < 1.9) expect(Math.abs(dip - 0.67 * pip), `${L}${k} ${f}`).toBeLessThan(0.45);
          // Só o indicador cruzado com o médio (R) passa do limite normal
          expect(Math.abs(spread), `${L}${k} ${f}`).toBeLessThanOrEqual((f === 'index' ? 0.6 : 0.34) + 1e-9);
        }
        expect(Math.abs(d.thumbTwist!)).toBeLessThanOrEqual(1.25 + 1e-9);
      }
    }
  });

  it('pele não atravessa pele: nem nas poses, nem no meio da troca de letra ou de pessoa', () => {
    const order = ['L', 'I', 'B', 'R', 'A', 'X'];
    let worst = 0;
    for (let i = 0; i < order.length; i++) {
      for (let k = 0; k < 8; k++) {
        const a = retarget(rig, landmarks(order[i], k));
        const b = retarget(rig, landmarks(order[(i + 1) % order.length], (k + 1) % 8));
        for (const t of [0, 0.25, 0.5, 0.75]) {
          const st: CollisionStats = { contacts: 0, depth: 0 };
          solveCollisions(rig, clonePose(mixPose(a, b, t)), 12, st);
          worst = Math.max(worst, st.depth);
        }
      }
    }
    // Invasão restante menor que 1% da palma (a pele cede um pouco no contato)
    expect(worst).toBeLessThan(0.01);
  });

  it('R: indicador e médio cruzados continuam cruzados depois da colisão', () => {
    let crossed = 0;
    for (let k = 0; k < letras.R.poses.length; k++) {
      const pose = retarget(rig, landmarks('R', k));
      if (pose.cross < 0.5) continue;
      const toPalm = pose.hand.clone().multiply(rig.palm).invert();
      const pos = positions(rig, solveCollisions(rig, clonePose(pose)));
      const x = (j: number) => pos[j].clone().sub(pos[B.wrist]).applyQuaternion(toPalm).x;
      // A ponta do indicador passa para o lado do médio (ou quase)
      if (x(B.index_tip) - x(B.middle_tip) < 0.05) crossed += 1;
    }
    expect(crossed).toBeGreaterThanOrEqual(4);
  });

  it('a transição entre duas pessoas mantém o comprimento dos ossos', () => {
    const a = retarget(rig, landmarks('A', 0));
    const b = retarget(rig, landmarks('X', 1));
    const pos = positions(rig, solveCollisions(rig, mixPose(a, b, 0.5)));
    const rest = rig.worldPos;
    for (const j of [B.index_pip, B.thumb_ip, B.pinky_tip]) {
      const p = rig.parent[j];
      expect(pos[j].distanceTo(pos[p])).toBeCloseTo(rest[j].distanceTo(rest[p]), 6);
    }
  });
});
