// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import modelJson from '../../public/ml/numeros/model.json';
import golden from '../../public/ml/numeros/golden.json';
import type { Lm } from '../lib/recognizer';
import { normalizeHand, NORMALIZATION_VERSION } from '../recognition/normalize';
import { parseMlp, predict, type MlpModel } from '../recognition/mlp';
import { createMlpClassifier, MLP_MIN_PROBABILITY } from '../recognition/classifier';
import { checkNumberModelJson } from '../recognition/numberModel';

/**
 * Paridade TS x Python do modelo dos números publicado (public/ml/numeros/). O golden.json sai do
 * próprio ml-training/train_numeros15.py: landmarks brutos de quadros do dataset (números, mãos em
 * repouso e letras), a entrada normalizada do Python e o softmax do Keras. Critério da W1:
 * diferença máxima abaixo de 1e-4.
 */
const TOLERANCE = 1e-4;

interface GoldenCase { raw: number[]; handedness: string | null; aspect: number; input: number[]; probs: number[] }

function points(flat: number[]): Lm[] {
  const out: Lm[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] });
  return out;
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]) / Math.max(1, Math.abs(b[i])));
  return m;
}

let model: MlpModel;
const cases = golden.cases as GoldenCase[];

beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(path: URL): Uint8Array };
  const here = import.meta.url;
  const bytes = fs.readFileSync(new URL('../../public/ml/numeros/weights.bin', here));
  model = parseMlp(modelJson, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
});

describe('paridade do modelo dos números com o Python', () => {
  it('model.json no contrato, com a normalização do app e o limiar das letras paradas', () => {
    expect(checkNumberModelJson(modelJson)).toBeNull();
    expect(golden.normalization_version).toBe(NORMALIZATION_VERSION);
    expect(golden.labels).toEqual(modelJson.labels);
    expect(modelJson.min_probability).toBe(MLP_MIN_PROBABILITY);
    expect(cases.length).toBeGreaterThanOrEqual(10);
  });

  it('normalização e softmax iguais aos do Python nos vetores dourados', () => {
    for (const c of cases) {
      const input = normalizeHand(points(c.raw), { handedness: c.handedness, aspect: c.aspect });
      expect(maxDiff(input, c.input)).toBeLessThan(TOLERANCE);
      expect(maxDiff(predict(model, input), c.probs)).toBeLessThan(TOLERANCE);
    }
  });

  it('o classificador lê o número do Python (ou nada abaixo do limiar e no "_")', () => {
    const clf = createMlpClassifier(model);
    for (const c of cases) {
      const best = c.probs.indexOf(Math.max(...c.probs));
      const label = model.labels[best];
      const expected = label !== '_' && c.probs[best] >= MLP_MIN_PROBABILITY ? label : null;
      expect(clf.classify(points(c.raw), { handedness: c.handedness, aspect: c.aspect }).letter).toBe(expected);
    }
  });
});
