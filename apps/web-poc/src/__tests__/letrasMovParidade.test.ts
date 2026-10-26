// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import modelJson from '../recognition/__fixtures__/letras-mov/model.json';
import golden from '../recognition/__fixtures__/letras-mov/golden.json';
import type { Lm } from '../lib/recognizer';
import { parseMlp, predict, type MlpModel } from '../recognition/mlp';
import { NORMALIZATION_VERSION } from '../recognition/normalize';
import {
  compactLetterWindow, createLetterMotionRecognizer, frameHand, LETTER_BUFFER_S, LETTER_EVAL_MS, LETTER_FRAME_DIM,
  LETTER_MIN_PROBABILITY, LETTER_MODEL_FRAME_INDEX, LETTER_MODEL_FRAMES, LETTER_WINDOW_FRAMES, LETTER_WINDOWS_S,
  letterWindow, letterWindowDrawing, letterWindowMotion, MIN_PRESENCE, NO_LETTER, windowHandedness, type LetterFrame,
} from '../recognition/letterMotion';
import { checkLetterMotionModelJson } from '../recognition/letterMotionModel';
import { CONFIRM_READINGS } from '../hooks/useSignCameraRecognizer';

/**
 * Paridade TS x Python das letras com movimento. O fixture sai de
 * scripts/gerar-fixture-letras-mov.py, que roda o código do treino (janela, mao_do_quadro,
 * rotulo_janela e compactar do ml-training/train_letras_mov.py) sobre landmarks de vídeos do
 * alfabeto a 15 quadros por segundo e casos sintéticos. Critério: diferença máxima abaixo de 1e-4.
 */
const TOLERANCE = 1e-4;

interface RawHand { h: string | null; lm: number[] }
interface RawFrame { t: number; hands: RawHand[] }
interface Fixture {
  contract: {
    normalization_version: number; T: number; F: number; frames: number; windows_s: number[]; min_presence: number;
    min_p: number; none: string; buffer_s: number; eval_s: number; confirm: number; motion_shape_weight: number;
  };
  /** Entradas sorteadas com a mão em alguns passos, com o movimento do Python. */
  motionCases: { input: number[]; motion: number }[];
  handCases: { name: string; frame: RawFrame; expected: number | null }[];
  labelCases: { name: string; frames: RawFrame[]; t0: number; t1: number; expected: string | null }[];
  clips: {
    id: string; letra: string; aspect: number; frames: RawFrame[];
    windows: {
      t0: number; t1: number; input: number[] | null; motion: number | null; resampled?: number[];
      /** desenho() do treino na janela inteira (regras por letra). */
      drawing?: { displacement: number; shapeChange: number; shapeOscillation: number };
    }[];
  }[];
}
interface GoldenCase { clip?: number; window?: number; input?: number[]; probs: number[] }

type Fs = { readFileSync(path: URL | string, enc?: string): string | Uint8Array; existsSync(path: URL | string): boolean };
const nodeFs = async () => (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
const here = import.meta.url;
const fixtureFile = (name: string) => new URL(`../recognition/__fixtures__/letras-mov/${name}`, here);

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function points(flat: number[]): Lm[] {
  const out: Lm[] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) out.push({ x: flat[i], y: flat[i + 1], z: flat[i + 2] });
  return out;
}

function toFrame(f: RawFrame): LetterFrame {
  return { t: f.t, hands: f.hands.map(h => ({ handedness: h.h, landmarks: points(h.lm) })) };
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

describe('contrato da janela das letras com movimento', () => {
  it('constantes iguais às do treino', () => {
    const c = fixture.contract;
    expect(c.normalization_version).toBe(NORMALIZATION_VERSION);
    expect([c.T, c.F, c.frames]).toEqual([LETTER_WINDOW_FRAMES, LETTER_FRAME_DIM, LETTER_MODEL_FRAMES]);
    expect(c.windows_s).toEqual([...LETTER_WINDOWS_S]);
    expect([c.min_presence, c.min_p, c.none]).toEqual([MIN_PRESENCE, LETTER_MIN_PROBABILITY, NO_LETTER]);
    expect([c.buffer_s, c.eval_s * 1000, c.confirm]).toEqual([LETTER_BUFFER_S, LETTER_EVAL_MS, CONFIRM_READINGS]);
    expect(LETTER_MODEL_FRAME_INDEX).toEqual([0, 3, 7, 10, 13, 16, 20, 23]);
  });
});

describe('mão do quadro e rótulo da janela', () => {
  it('a mão mais alta; sem mão, nenhuma', () => {
    for (const c of fixture.handCases) {
      const f = toFrame(c.frame);
      const got = frameHand(f.hands);
      expect([c.name, got ? f.hands.indexOf(got) : null]).toEqual([c.name, c.expected]);
    }
  });

  it('o rótulo mais visto na janela; empate fica com o primeiro', () => {
    for (const c of fixture.labelCases) {
      expect([c.name, windowHandedness(c.frames.map(toFrame), c.t0, c.t1)]).toEqual([c.name, c.expected]);
    }
  });
});

describe('janela e entrada do modelo', () => {
  it('trechos reais, com buracos, com outra mão e quase sem mão', () => {
    expect(fixture.clips.length).toBeGreaterThanOrEqual(5);
    let compared = 0;
    for (const clip of fixture.clips) {
      const frames = clip.frames.map(toFrame);
      for (const w of clip.windows) {
        const win = letterWindow(frames, clip.aspect, w.t0, w.t1);
        if (w.input === null) {
          expect([clip.id, w.t0, win]).toEqual([clip.id, w.t0, null]);
          continue;
        }
        expect(win, `${clip.id} ${w.t0}`).not.toBeNull();
        expect(win).toHaveLength(LETTER_WINDOW_FRAMES);
        if (w.resampled) {
          const flat = new Float64Array(LETTER_WINDOW_FRAMES * LETTER_FRAME_DIM);
          win!.forEach((row, i) => flat.set(row, i * LETTER_FRAME_DIM));
          expect(maxDiff(flat, w.resampled)).toBeLessThan(TOLERANCE);
        }
        expect(maxDiff(compactLetterWindow(win!), w.input)).toBeLessThan(TOLERANCE);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(12);
  });

  it('o reconhecedor monta as mesmas entradas a partir dos quadros ao vivo', () => {
    for (const clip of fixture.clips) {
      const rec = createLetterMotionRecognizer(model);
      for (const f of clip.frames) rec.push(toFrame(f), clip.aspect);
      const expected = clip.windows.slice(0, LETTER_WINDOWS_S.length)
        .map((w, i) => ({ duration: LETTER_WINDOWS_S[i], input: w.input }))
        .filter(w => w.input !== null);
      const got = rec.windowInputs();
      expect(got.map(w => w.duration)).toEqual(expected.map(w => w.duration));
      got.forEach((w, i) => expect(maxDiff(w.input, expected[i].input!)).toBeLessThan(TOLERANCE));
    }
  });
});

describe('movimento da janela (portão das regras de leitura)', () => {
  it('o mesmo do movimento() do train_letras_mov.py nas janelas reais e em entradas sorteadas', () => {
    const weight = fixture.contract.motion_shape_weight;
    let n = 0;
    for (const clip of fixture.clips) {
      for (const w of clip.windows) {
        if (w.input === null) continue;
        expect(Math.abs(letterWindowMotion(w.input, weight) - w.motion!)).toBeLessThan(TOLERANCE);
        n++;
      }
    }
    expect(n).toBeGreaterThan(12);
    expect(fixture.motionCases.length).toBeGreaterThanOrEqual(4);
    for (const c of fixture.motionCases) expect(Math.abs(letterWindowMotion(c.input, weight) - c.motion)).toBeLessThan(TOLERANCE);
  });
});

describe('desenho da janela (regras por letra)', () => {
  it('o mesmo do desenho() do train_letras_mov.py nas janelas reais, com buracos e com outra mão', () => {
    let n = 0;
    for (const clip of fixture.clips) {
      const frames = clip.frames.map(toFrame);
      for (const w of clip.windows) {
        if (w.input === null) continue;
        expect(w.drawing, `${clip.id} ${w.t0}`).toBeDefined();
        const got = letterWindowDrawing(letterWindow(frames, clip.aspect, w.t0, w.t1)!);
        for (const k of ['displacement', 'shapeChange', 'shapeOscillation'] as const) {
          expect(Math.abs(got[k] - w.drawing![k]), `${clip.id} ${w.t0} ${k}`).toBeLessThan(TOLERANCE);
        }
        n++;
      }
    }
    expect(n).toBeGreaterThan(12);
  });
});

describe('MLP das letras com movimento', () => {
  it('o model.json do fixture segue o contrato (kind "letras-mov", 8 x 69 de 24)', () => {
    expect(checkLetterMotionModelJson(modelJson)).toBeNull();
    expect(model.inputDim).toBe(LETTER_MODEL_FRAMES * LETTER_FRAME_DIM);
  });

  it('o softmax em TS é o do Python (mlp_forward)', () => {
    const cases = golden.cases as GoldenCase[];
    expect(cases.length).toBeGreaterThanOrEqual(8);
    let worst = 0;
    for (const c of cases) {
      const input = c.input ?? fixture.clips[c.clip!].windows[c.window!].input!;
      worst = Math.max(worst, maxDiff(predict(model, input), c.probs));
    }
    expect(worst).toBeLessThan(TOLERANCE);
  });
});

/**
 * Modelo de verdade: o golden.json do train_letras_mov.py treinar (softmax do Keras). Confere quando
 * há modelo em LIBRAX_LETRAS_MOV_DIR ou em public/ml/letras-mov/ com o golden.json junto; senão pula.
 */
describe('modelo treinado (golden.json do train_letras_mov.py)', () => {
  it('o softmax em TS é o do Keras', async (ctx) => {
    const fs = await nodeFs();
    const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
    const dir = env.LIBRAX_LETRAS_MOV_DIR
      ? `file://${env.LIBRAX_LETRAS_MOV_DIR.replace(/\/?$/, '/')}`
      : new URL('../../public/ml/letras-mov/', here).href;
    const file = (name: string) => new URL(name, dir);
    if (!['model.json', 'weights.bin', 'golden.json'].every(f => fs.existsSync(file(f)))) ctx.skip();
    const json = JSON.parse(fs.readFileSync(file('model.json'), 'utf8') as string);
    expect(checkLetterMotionModelJson(json)).toBeNull();
    const real = parseMlp(json, toArrayBuffer(fs.readFileSync(file('weights.bin')) as Uint8Array));
    const gold = JSON.parse(fs.readFileSync(file('golden.json'), 'utf8') as string) as { labels: string[]; cases: GoldenCase[] };
    expect(gold.labels).toEqual(real.labels);
    let worst = 0;
    for (const c of gold.cases) worst = Math.max(worst, maxDiff(predict(real, c.input!), c.probs));
    expect(worst).toBeLessThan(TOLERANCE);
  });
});
