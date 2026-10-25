import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Quaternion, Vector3 } from 'three';
import { JOINTS, SPECS, makeRest, positions, retarget, slerpPose } from '../retarget';
import maos from '../maos.json';
import maosZ from '../maos-z.json';

/** Articulações em repouso lidas direto do GLB do pacote (cabeçalho JSON do arquivo). */
function restFromGlb() {
  const require = createRequire(import.meta.url);
  const buf = readFileSync(require.resolve('@webxr-input-profiles/assets/dist/profiles/generic-hand/right.glb'));
  const len = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + len).toString('utf8')) as {
    nodes: { name: string; translation?: number[]; rotation?: number[] }[];
  };
  const byName = new Map(gltf.nodes.map((n) => [n.name, n]));
  const nodes = JOINTS.map((j) => byName.get(j)!);
  return makeRest(
    nodes.map((n) => new Vector3(...(n.translation ?? [0, 0, 0]))),
    nodes.map((n) => new Quaternion(...(n.rotation ?? [0, 0, 0, 1]))),
  );
}

function landmarks(letter: string, k: number): Vector3[] {
  const p = (maos.letras as Record<string, { poses: number[][] }>)[letter].poses[k];
  const z = (maosZ.letras as Record<string, number[][]>)[letter][k];
  return Array.from({ length: 21 }, (_, i) => new Vector3(p[i * 2], -p[i * 2 + 1], -z[i]));
}

describe('retargeting da mão em 3D', () => {
  const rest = restFromGlb();

  it('o modelo tem as 25 articulações do WebXR', () => {
    expect(rest.pos).toHaveLength(25);
    expect(rest.pos.every((p) => Number.isFinite(p.x))).toBe(true);
  });

  it('a profundidade cobre as mesmas poses do maos.json', () => {
    for (const [L, info] of Object.entries(maos.letras)) {
      expect((maosZ.letras as Record<string, number[][]>)[L]).toHaveLength(info.poses.length);
    }
  });

  it('cada osso dos dedos aponta para o landmark seguinte, em todas as poses', () => {
    let soma = 0;
    let n = 0;
    for (const L of Object.keys(maos.letras)) {
      for (let k = 0; k < 8; k++) {
        const lm = landmarks(L, k);
        const q = retarget(rest, lm);
        const pos = positions(rest, q);
        SPECS.forEach((s, j) => {
          if (s.kind !== 'aim' || !s.dir) return;
          const want = lm[s.dir[1]].clone().sub(lm[s.dir[0]]).normalize();
          const got = pos[j + 1].clone().sub(pos[j]).normalize();
          // Sem limite, exato; com limite de articulação, perto (o limite corta o ruído)
          if (!s.limit) expect(got.dot(want), `${L}${k} ${JOINTS[j]}`).toBeGreaterThan(0.999);
          else {
            expect(got.dot(want), `${L}${k} ${JOINTS[j]}`).toBeGreaterThan(0.2);
            soma += got.dot(want);
            n += 1;
          }
        });
      }
    }
    expect(soma / n).toBeGreaterThan(0.93);
  });

  it('a palma fica na mesma direção dos dados', () => {
    const lm = landmarks('B', 0);
    const pos = positions(rest, retarget(rest, lm));
    const want = lm[9].clone().sub(lm[0]).normalize();
    const got = pos[11].clone().sub(pos[0]).normalize();
    expect(got.dot(want)).toBeGreaterThan(0.99);
  });

  it('a transição entre duas pessoas mantém os ossos com o comprimento do modelo', () => {
    const a = retarget(rest, landmarks('A', 0));
    const b = retarget(rest, landmarks('X', 1));
    const pos = positions(rest, slerpPose(a, b, 0.5));
    expect(pos[8].distanceTo(pos[7])).toBeCloseTo(rest.len[7], 6);
  });
});
