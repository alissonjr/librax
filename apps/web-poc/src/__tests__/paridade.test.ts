// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import modelJson from '../recognition/__fixtures__/paridade/model.json';
import golden from '../recognition/__fixtures__/paridade/golden.json';
import { normalizeHand, NORMALIZATION_VERSION, FEATURE_DIM } from '../recognition/normalize';
import { classify, parseMlp, predict, MlpFormatError, type MlpModel } from '../recognition/mlp';
import type { Lm } from '../lib/recognizer';

/**
 * Paridade TS x Python. O fixture sai de ml-training/gerar_fixture_paridade.py: maos sinteticas,
 * normalize_hand e um MLP pequeno treinado em numpy (sem TensorFlow neste ambiente). Os vetores
 * dourados guardam os landmarks brutos, a entrada normalizada e o softmax esperado.
 * Criterio da W1: diferenca maxima abaixo de 1e-4.
 */
const TOLERANCE = 1e-4;

interface GoldenCase {
  raw: number[];
  handedness: string | null;
  aspect: number;
  input: number[];
  probs: number[];
}

/** Lê o weights.bin do disco (o teste roda no Node). */
async function readWeights(): Promise<ArrayBuffer> {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
    readFileSync(path: URL): Uint8Array;
  };
  const bytes = fs.readFileSync(new URL('../recognition/__fixtures__/paridade/weights.bin', import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function toLandmarks(raw: number[]): Lm[] {
  const out: Lm[] = [];
  for (let i = 0; i < raw.length; i += 3) out.push({ x: raw[i], y: raw[i + 1], z: raw[i + 2] });
  return out;
}

/** Diferença relativa para valores grandes (escala 1e6 do caso degenerado), absoluta perto de 0. */
function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])));
  return m;
}

let model: MlpModel;
const cases = golden.cases as GoldenCase[];

beforeAll(async () => {
  model = parseMlp(modelJson, await readWeights());
});

describe('paridade com o Python (vetores dourados)', () => {
  it('o fixture usa a mesma versão de normalização do app', () => {
    expect(golden.normalization_version).toBe(NORMALIZATION_VERSION);
    expect(model.normalizationVersion).toBe(NORMALIZATION_VERSION);
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('normalizeHand em TS dá o mesmo vetor que normalize_hand em Python', () => {
    for (const c of cases) {
      const ts = normalizeHand(toLandmarks(c.raw), { handedness: c.handedness, aspect: c.aspect });
      expect(ts).toHaveLength(FEATURE_DIM);
      expect(maxDiff(ts, c.input)).toBeLessThan(1e-9);
    }
  });

  it('o MLP em TS dá o mesmo softmax que o Python', () => {
    let worst = 0;
    for (const c of cases) {
      const probs = predict(model, c.input);
      worst = Math.max(worst, maxDiff(probs, c.probs));
    }
    expect(worst).toBeLessThan(TOLERANCE);
  });

  it('pipeline completo (landmarks brutos -> letra) bate com o esperado', () => {
    for (const c of cases) {
      const input = normalizeHand(toLandmarks(c.raw), { handedness: c.handedness, aspect: c.aspect });
      const { label } = classify(model, input);
      const expected = golden.labels[c.probs.indexOf(Math.max(...c.probs))];
      expect(label).toBe(expected);
    }
  });
});

describe('normalizeHand: propriedades do contrato', () => {
  const hand = toLandmarks(cases[0].raw);

  it('pulso na origem e pulso -> dedo médio apontando para cima com comprimento 1', () => {
    const v = normalizeHand(hand, { aspect: 4 / 3 });
    expect(v.slice(0, 3).map(Math.abs)).toEqual([0, 0, 0]);
    expect(v[27]).toBeCloseTo(0, 9);
    expect(Math.hypot(v[27], v[28], v[29])).toBeCloseTo(1, 9);
    expect(v[28]).toBeLessThan(0);
  });

  it('não depende de posição, tamanho nem rotação no plano', () => {
    const base = normalizeHand(hand, { aspect: 1 });
    const ang = 0.6;
    const moved = hand.map(p => ({
      x: 0.2 + 0.5 * ((p.x - hand[0].x) * Math.cos(ang) - (p.y - hand[0].y) * Math.sin(ang)),
      y: 0.3 + 0.5 * ((p.x - hand[0].x) * Math.sin(ang) + (p.y - hand[0].y) * Math.cos(ang)),
      z: 0.5 * p.z,
    }));
    expect(maxDiff(normalizeHand(moved, { aspect: 1 }), base)).toBeLessThan(1e-9);
  });

  it('mão esquerda espelhada vira a mesma mão direita (rótulo do MediaPipe invertido)', () => {
    const right = normalizeHand(hand, { handedness: 'Left', aspect: 1 }); // "Left" = mão direita
    const mirrored = hand.map(p => ({ x: 1 - p.x, y: p.y, z: p.z }));
    const left = normalizeHand(mirrored, { handedness: 'Right', aspect: 1 }); // "Right" = esquerda
    expect(maxDiff(left, right)).toBeLessThan(1e-9);
  });

  it('a mesma mão em quadro deitado ou em pé dá o mesmo vetor', () => {
    // Mesma mão em pixels, vista num quadro 640x480 e num 480x640
    const px = hand.map(p => ({ x: p.x * 400, y: p.y * 400, z: p.z * 400 }));
    const wide = px.map(p => ({ x: p.x / 640, y: p.y / 480, z: p.z / 640 }));
    const tall = px.map(p => ({ x: p.x / 480, y: p.y / 640, z: p.z / 480 }));
    expect(maxDiff(normalizeHand(wide, { aspect: 640 / 480 }), normalizeHand(tall, { aspect: 480 / 640 }))).toBeLessThan(1e-9);
  });

  it('escala zero usa o fator 1e6 como a normalizeHand de referência', () => {
    const flat = hand.map(() => ({ ...hand[0] }));
    expect(normalizeHand(flat).every(v => Math.abs(v) === 0)).toBe(true);
    expect(normalizeHand(hand.slice(0, 10))).toEqual([]);
  });
});

describe('parseMlp', () => {
  it('recusa pesos com tamanho errado e formato desconhecido', async () => {
    const weights = await readWeights();
    expect(() => parseMlp(modelJson, weights.slice(0, 100))).toThrow(MlpFormatError);
    expect(() => parseMlp({ ...modelJson, format: 'outro' }, weights)).toThrow(MlpFormatError);
    expect(() => predict(model, [1, 2, 3])).toThrow(MlpFormatError);
  });
});
