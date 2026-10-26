// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import modelJson from '../recognition/__fixtures__/sinais/model.json';
import golden from '../recognition/__fixtures__/sinais/golden.json';
import type { Lm } from '../lib/recognizer';
import { parseMlp, predict, type MlpModel } from '../recognition/mlp';
import { NORMALIZATION_VERSION } from '../recognition/normalize';
import {
  compactWindow, dominantHand, frameFeatures, MODEL_FRAME_INDEX, MODEL_FRAMES, PER_HAND, resampleWindow,
  SIGN_FRAME_DIM, WINDOW_FRAMES, type SignFrame,
} from '../recognition/signFeatures';
import { checkSignModelJson, NO_SIGN_LABEL, SIGN_MIN_PROBABILITY } from '../recognition/signModel';
import { createSignRecognizer, signWindowMotion, SIGN_WINDOWS_S } from '../recognition/signRecognizer';

/**
 * Paridade TS x Python dos sinais com movimento. O fixture sai de scripts/gerar-fixture-sinais.py,
 * que roda o código do treino (features_quadro, mao_dominante e reamostrar do rotular_sinais.py,
 * compactar do train_sinais.py) sobre landmarks de vídeos reais e casos sintéticos.
 * Critério: diferença máxima abaixo de 1e-4.
 */
const TOLERANCE = 1e-4;

interface RawHand { h: string | null; lm: number[] }
interface RawFrame { t: number; hands: RawHand[]; pose: number[] | null }
interface Fixture {
  contract: {
    normalization_version: number; T: number; F: number; frames: number; per_hand: number; windows_s: number[];
    min_p: number; none: string; motion_shape_weight: number;
  };
  /** Entradas sorteadas com a presença ligada e desligada, com o movimento do Python. */
  motionCases: { input: number[]; motion: number }[];
  frameCases: { name: string; aspect: number; dominant: string | null; frame: RawFrame; expected: number[] | null }[];
  dominantCases: { name: string; aspect: number; frames: RawFrame[]; expected: string | null }[];
  clips: Clip[];
  /** Nenhuma mão aparece duas vezes: a dominante é a mais vista (dominante_ao_vivo do Python). */
  stillClip: Clip;
}
interface Clip {
  id: string; glosa: string; aspect: number; dominant: string | null; frames: RawFrame[];
  features: { index: number; expected: number[] | null }[];
  windows: { t0: number; t1: number; input: number[]; motion: number; resampled?: number[] }[];
}
interface GoldenCase { clip?: number; window?: number; input?: number[]; probs: number[] }

type Fs = { readFileSync(path: URL | string, enc?: string): string | Uint8Array; existsSync(path: URL | string): boolean };
const nodeFs = async () => (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
// Base numa variável: com import.meta.url direto no new URL o Vite troca por um glob de assets
const here = import.meta.url;
const fixtureFile = (name: string) => new URL(`../recognition/__fixtures__/sinais/${name}`, here);

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function points(flat: number[], stride: number): Lm[] {
  const out: Lm[] = [];
  for (let i = 0; i + 2 < flat.length; i += stride) out.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] });
  return out;
}

function toFrame(f: RawFrame): SignFrame {
  return {
    t: f.t,
    hands: f.hands.map(h => ({ handedness: h.h, landmarks: points(h.lm, 3) })),
    pose: f.pose ? points(f.pose, 4) : null,
  };
}

function maxDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  expect(a.length).toBe(b.length);
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

let fixture: Fixture;
let model: MlpModel;

beforeAll(async () => {
  const fs = await nodeFs();
  fixture = JSON.parse(fs.readFileSync(fixtureFile('features.json'), 'utf8') as string);
  model = parseMlp(modelJson, toArrayBuffer(fs.readFileSync(fixtureFile('weights.bin')) as Uint8Array));
});

describe('contrato da janela (constantes iguais às do treino)', () => {
  it('T, F, quadros do modelo, janelas, limiar e classe "nenhum sinal"', () => {
    const c = fixture.contract;
    expect(c.normalization_version).toBe(NORMALIZATION_VERSION);
    expect([c.T, c.F, c.frames, c.per_hand]).toEqual([WINDOW_FRAMES, SIGN_FRAME_DIM, MODEL_FRAMES, PER_HAND]);
    expect(c.windows_s).toEqual([...SIGN_WINDOWS_S]);
    expect(c.min_p).toBe(SIGN_MIN_PROBABILITY);
    expect(c.none).toBe(NO_SIGN_LABEL);
    expect(MODEL_FRAME_INDEX).toEqual([0, 3, 7, 10, 13, 16, 20, 23]);
  });
});

describe('features_quadro', () => {
  it('casos sintéticos: sem corpo, ombros juntos, sem mão, espelho e rótulos repetidos', () => {
    expect(fixture.frameCases.length).toBeGreaterThanOrEqual(8);
    for (const c of fixture.frameCases) {
      const got = frameFeatures(toFrame(c.frame), c.aspect, c.dominant);
      if (c.expected === null) {
        expect([c.name, got]).toEqual([c.name, null]);
        continue;
      }
      expect(got, c.name).not.toBeNull();
      expect([c.name, maxDiff(got!, c.expected) < TOLERANCE]).toEqual([c.name, true]);
    }
  });

  it('quadros reais dos vídeos de sinais', () => {
    let n = 0;
    for (const clip of fixture.clips) {
      for (const { index, expected } of clip.features) {
        const got = frameFeatures(toFrame(clip.frames[index]), clip.aspect, clip.dominant);
        if (expected === null) expect(got).toBeNull();
        else expect(maxDiff(got!, expected)).toBeLessThan(TOLERANCE);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10);
  });
});

describe('mao_dominante', () => {
  it('a que mais anda; sem movimento, null; empate fica com a primeira', () => {
    for (const c of fixture.dominantCases) {
      expect([c.name, dominantHand(c.frames.map(toFrame), c.aspect)]).toEqual([c.name, c.expected]);
    }
  });

  it('nos trechos reais (calculada só no trecho, como ao vivo)', () => {
    expect(fixture.clips.map(c => c.dominant).sort()).toEqual(['Left', 'Right']);
    for (const clip of fixture.clips) expect(dominantHand(clip.frames.map(toFrame), clip.aspect)).toBe(clip.dominant);
  });
});

describe('reamostrar + compactar', () => {
  it('janelas de 1, 1,5 e 2 s e uma que começa antes do primeiro quadro', () => {
    for (const clip of fixture.clips) {
      const frames = clip.frames.map(toFrame);
      const ts = frames.map(f => f.t);
      const feats = frames.map(f => frameFeatures(f, clip.aspect, clip.dominant));
      for (const w of clip.windows) {
        const win = resampleWindow(ts, feats, w.t0, w.t1);
        expect(win).toHaveLength(WINDOW_FRAMES);
        if (w.resampled) {
          const flat = new Float64Array(WINDOW_FRAMES * SIGN_FRAME_DIM);
          win.forEach((row, i) => flat.set(row, i * SIGN_FRAME_DIM));
          expect(maxDiff(flat, w.resampled)).toBeLessThan(TOLERANCE);
        }
        expect(maxDiff(compactWindow(win), w.input)).toBeLessThan(TOLERANCE);
      }
    }
  });

  it('o reconhecedor monta as mesmas entradas a partir dos quadros ao vivo', () => {
    for (const clip of fixture.clips) {
      const rec = createSignRecognizer(model);
      for (const f of clip.frames) rec.push(toFrame(f), clip.aspect);
      expect(rec.size()).toBe(clip.frames.length);
      const inputs = rec.windowInputs();
      expect(inputs.map(i => i.duration)).toEqual([...SIGN_WINDOWS_S]);
      inputs.forEach((w, i) => expect(maxDiff(w.input, clip.windows[i].input)).toBeLessThan(TOLERANCE));
    }
  });

  it('sem mão que apareça duas vezes, o reconhecedor usa a mais vista, como o treino (dominante_ao_vivo)', () => {
    const clip = fixture.stillClip;
    const frames = clip.frames.map(toFrame);
    expect(dominantHand(frames, clip.aspect)).toBeNull();
    expect(clip.dominant).toBe('Left');
    const rec = createSignRecognizer(model);
    for (const f of frames) rec.push(f, clip.aspect);
    const inputs = rec.windowInputs();
    expect(inputs.map(i => i.duration)).toEqual([...SIGN_WINDOWS_S]);
    inputs.forEach((w, i) => expect(maxDiff(w.input, clip.windows[i].input)).toBeLessThan(TOLERANCE));
  });
});

describe('movimento da janela (portão das regras de leitura)', () => {
  it('o mesmo do movimento() do train_sinais.py nas janelas reais, no trecho parado e em entradas sorteadas', () => {
    const w = fixture.contract.motion_shape_weight;
    const windows = [...fixture.clips, fixture.stillClip].flatMap(c => c.windows);
    expect(windows.length).toBeGreaterThan(8);
    for (const win of windows) expect(Math.abs(signWindowMotion(win.input, w) - win.motion)).toBeLessThan(TOLERANCE);
    expect(fixture.motionCases.length).toBeGreaterThanOrEqual(4);
    for (const c of fixture.motionCases) expect(Math.abs(signWindowMotion(c.input, w) - c.motion)).toBeLessThan(TOLERANCE);
  });
});

describe('MLP dos sinais', () => {
  it('o model.json do fixture segue o contrato (kind "sinais", 8 x 140 de 24)', () => {
    expect(checkSignModelJson(modelJson)).toBeNull();
    expect(model.inputDim).toBe(MODEL_FRAMES * SIGN_FRAME_DIM);
  });

  it('o softmax em TS é o do Python (mlp_forward) nas janelas reais e em entradas sorteadas', () => {
    const cases = golden.cases as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(8);
    let worst = 0;
    for (const c of cases) {
      const input = c.input ?? fixture.clips[c.clip!].windows[c.window!].input;
      worst = Math.max(worst, maxDiff(predict(model, input), c.probs));
    }
    expect(worst).toBeLessThan(TOLERANCE);
  });
});

/**
 * Modelo de verdade: o golden.json do train_sinais.py treinar (softmax do scikit-learn). Confere quando há
 * modelo em LIBRAX_SINAIS_DIR ou em public/ml/sinais/ com o golden.json junto; senão pula.
 */
describe('modelo treinado (golden.json do train_sinais.py)', () => {
  it('o softmax em TS é o do Keras', async (ctx) => {
    const fs = await nodeFs();
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const dir = env.LIBRAX_SINAIS_DIR
      ? `file://${env.LIBRAX_SINAIS_DIR.replace(/\/?$/, '/')}`
      : new URL('../../public/ml/sinais/', here).href;
    const file = (name: string) => new URL(name, dir);
    if (!['model.json', 'weights.bin', 'golden.json'].every(f => fs.existsSync(file(f)))) ctx.skip();
    const json = JSON.parse(fs.readFileSync(file('model.json'), 'utf8') as string);
    expect(checkSignModelJson(json)).toBeNull();
    const real = parseMlp(json, toArrayBuffer(fs.readFileSync(file('weights.bin')) as Uint8Array));
    const gold = JSON.parse(fs.readFileSync(file('golden.json'), 'utf8') as string) as { labels: string[]; cases: GoldenCase[] };
    expect(gold.labels).toEqual(real.labels);
    let worst = 0;
    for (const c of gold.cases) worst = Math.max(worst, maxDiff(predict(real, c.input!), c.probs));
    expect(worst).toBeLessThan(TOLERANCE);
  });
});
