// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import dados from '../mao3d/maos-licoes.json';
import signs from '../assets/content/signs.json';
import { MAO3D_MOVING, MAO3D_STATIC, hasHand3d } from '../mao3d/disponivel';
import { FPS, clipFor, clipGlosses } from '../mao3d/poses';
import { HOLD_MS, LEAD_MS, RETURN_MS, cycleMs, midMovementMs, sampleAt } from '../mao3d/linhaDoTempo';
import { clonePose, positions, retarget, rigFromGlbBytes, solveCollisions } from '../mao3d/retarget';
import { sceneLandmarks } from '../mao3d/cena';

type Fs = { readFileSync(path: URL): Uint8Array };
let rig: ReturnType<typeof rigFromGlbBytes>;
beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
  rig = rigFromGlbBytes(fs.readFileSync(new URL('../mao3d/mao-3d.glb', import.meta.url)));
});
const all = [...MAO3D_STATIC, ...MAO3D_MOVING];
const signList = signs as { id: string; gloss: string; category: string; notes?: string }[];

describe('mão 3D: dados das poses (maos-licoes.json)', () => {
  it('tem exatamente as letras e números que o app oferece', () => {
    expect(clipGlosses().sort()).toEqual([...all].sort());
    for (const g of MAO3D_MOVING) expect(clipFor(g)?.moving).toBe(true);
    for (const g of MAO3D_STATIC) expect(clipFor(g)?.moving).toBe(false);
  });

  it('cobre o alfabeto inteiro (A a Z e Ç) e os números de 0 a 9, menos os de fora com motivo', () => {
    const fora = Object.keys(dados.fora);
    const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÇ'.split('');
    const numeros = '0123456789'.split('');
    for (const g of [...letras, ...numeros]) {
      expect(all.includes(g) || fora.includes(g), g).toBe(true);
    }
    // Só fica de fora número marcado A CONFERIR no conteúdo (os dados discordam da descrição)
    for (const g of fora) {
      const sign = signList.find((s) => s.category === 'numeros' && s.gloss === g);
      expect(sign?.notes).toMatch(/A CONFERIR/);
    }
  });

  it('cada sinal do curso com mão em 3D existe no conteúdo; palavras ficam sem', () => {
    for (const g of all) {
      const sign = signList.find((s) => s.gloss === g && (s.category === 'alfabeto' || s.category === 'numeros'));
      expect(sign, g).toBeDefined();
      expect(hasHand3d(sign!)).toBe(true);
    }
    expect(hasHand3d({ category: 'comida', gloss: 'BANANA' })).toBe(false);
    expect(hasHand3d({ category: 'numeros', gloss: '5' })).toBe(false);
    expect(hasHand3d({ category: 'numeros', gloss: '10' })).toBe(false);
  });

  it('cada pose: 21 pontos, pulso na origem e palmo = 1', () => {
    for (const g of all) {
      const clip = clipFor(g)!;
      expect(clip.people.length, g).toBeGreaterThanOrEqual(1);
      for (const p of clip.people) {
        expect(p.prob).toBeGreaterThanOrEqual(0.6);
        for (const f of p.frames) {
          expect(f).toHaveLength(63);
          expect(Math.hypot(f[0], f[1], f[2])).toBeLessThan(0.05);
          const palm = Math.hypot(f[27] - f[0], f[28] - f[1], f[29] - f[2]);
          expect(palm, g).toBeGreaterThan(0.85);
          expect(palm, g).toBeLessThan(1.15);
        }
      }
    }
  });

  it('letras com movimento: até 1,6 s a 15 quadros por segundo, sem saltos do pulso', () => {
    for (const g of MAO3D_MOVING) {
      for (const p of clipFor(g)!.people) {
        expect(p.frames.length).toBeGreaterThanOrEqual(8);
        expect(p.frames.length).toBeLessThanOrEqual(Math.round(1.6 * FPS) + 1);
        expect(p.wrist).toHaveLength(p.frames.length);
        for (let i = 1; i < p.wrist.length; i++) {
          const step = Math.hypot(p.wrist[i][0] - p.wrist[i - 1][0], p.wrist[i][1] - p.wrist[i - 1][1]);
          expect(step, `${g} quadro ${i}`).toBeLessThan(0.7);
        }
      }
    }
  });

  it('a orientação real fica: M e N apontam para baixo, L para cima, o 7 na horizontal', () => {
    const tip = (g: string, i: number) => {
      const f = clipFor(g)!.people[0].frames[0];
      return { x: f[i * 3], y: f[i * 3 + 1] };
    };
    // y para baixo nos dados: dedo para baixo tem y maior que o pulso
    expect(tip('M', 8).y).toBeGreaterThan(0);
    expect(tip('N', 12).y).toBeGreaterThan(0);
    expect(tip('L', 8).y).toBeLessThan(-1);
    const seven = tip('7', 8);
    const base = tip('7', 5);
    expect(Math.abs(seven.y - base.y)).toBeLessThan(Math.abs(seven.x - base.x));
    // L de quem olha: o polegar fica à direita do indicador
    expect(tip('L', 4).x).toBeGreaterThan(tip('L', 8).x);
  });

  it('todas as poses viram ângulos válidos no esqueleto do modelo', () => {
    for (const g of all) {
      for (const p of clipFor(g)!.people) {
        for (const f of [p.frames[0], p.frames[p.frames.length - 1]]) {
          const pose = retarget(rig, sceneLandmarks((i) => f[i * 3], (i) => f[i * 3 + 1], (i) => f[i * 3 + 2]));
          const local = solveCollisions(rig, clonePose(pose));
          for (const q of local) expect(Number.isFinite(q.x + q.y + q.z + q.w), g).toBe(true);
          for (const v of positions(rig, local)) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
        }
      }
    }
  });
});

describe('mão 3D: linha do tempo do movimento', () => {
  it('parado no começo, o movimento, parado no fim e a volta', () => {
    const n = 16;
    expect(sampleAt(n, 0)).toEqual({ from: 0, to: 0, t: 0 });
    expect(sampleAt(n, LEAD_MS + 1000 / FPS + 1).from).toBe(1);
    const mid = sampleAt(n, midMovementMs(n));
    expect(mid.from).toBeGreaterThan(0);
    expect(mid.from).toBeLessThan(n - 1);
    const moveMs = ((n - 1) / FPS) * 1000;
    expect(sampleAt(n, LEAD_MS + moveMs + HOLD_MS / 2)).toEqual({ from: n - 1, to: n - 1, t: 0 });
    const back = sampleAt(n, LEAD_MS + moveMs + HOLD_MS + RETURN_MS / 2);
    expect(back.from).toBe(n - 1);
    expect(back.to).toBe(0);
    expect(back.t).toBeGreaterThan(0.5);
    expect(sampleAt(n, cycleMs(n))).toEqual({ from: 0, to: 0, t: 0 });
  });

  it('um quadro só (letra parada): sempre ele', () => {
    expect(sampleAt(1, 12345)).toEqual({ from: 0, to: 0, t: 0 });
  });
});
