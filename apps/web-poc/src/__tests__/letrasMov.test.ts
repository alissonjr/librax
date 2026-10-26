import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Lm } from '../lib/recognizer';
import type { MlpModel } from '../recognition/mlp';
import {
  createLetterMotionRecognizer, DEFAULT_LETTER_RULES, LETTER_BUFFER_S, LETTER_FRAME_DIM, LETTER_INPUT_DIM,
  letterWindowMotion, type LetterFrame,
} from '../recognition/letterMotion';
import {
  checkLetterMotionModelJson, getLetterMotionReadingRules, getMotionLetters, loadLetterMotionIndex, loadLetterMotionModel,
  setLetterMotionModelForTests,
} from '../recognition/letterMotionModel';

/** Mão aberta com o pulso em (x, y). */
function hand(x: number, y: number): Lm[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: x + ((i % 5) - 2) * 0.01, y: y - 0.01 - Math.floor(i / 5) * 0.015, z: 0 }));
}

function frame(t: number, hands: { h: string; x: number; y: number }[]): LetterFrame {
  return { t, hands: hands.map(m => ({ handedness: m.h, landmarks: hand(m.x, m.y) })) };
}

/** MLP de uma camada (softmax): logit(rótulo) = w * presença no último passo do modelo + b. */
function tinyModel(labels: string[], weights: number[], bias: number[]): MlpModel {
  const n = labels.length;
  const kernel = new Float32Array(LETTER_INPUT_DIM * n);
  const lastPresence = 7 * LETTER_FRAME_DIM;
  weights.forEach((w, j) => { kernel[lastPresence * n + j] = w; });
  return {
    labels,
    normalizationVersion: 2,
    inputDim: LETTER_INPUT_DIM,
    layers: [{ in: LETTER_INPUT_DIM, out: n, activation: 'softmax', kernel, bias: Float32Array.from(bias) }],
  };
}

/** Quadros de t0 a t1 (s) a 15 fps com a mão desenhando uma curva. */
function drawing(t0: number, t1: number, h = 'Left'): LetterFrame[] {
  const out: LetterFrame[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 15) out.push(frame(t, [{ h, x: 0.4 + 0.05 * Math.sin(t * 6), y: 0.45 + 0.03 * t }]));
  return out;
}

const J_CERTO = tinyModel(['J', 'Z', '_'], [10, 0, 0], [-5, -8, 0]);

describe('reconhecedor das letras com movimento', () => {
  it('lê a letra quando o modelo passa do limiar e não é "_"', () => {
    const rec = createLetterMotionRecognizer(J_CERTO);
    for (const f of drawing(0, 2.1)) rec.push(f, 4 / 3);
    const r = rec.evaluate();
    expect(r.windows).toBe(3);
    expect(r.letter).toBe('J');
    expect(r.probability).toBeGreaterThan(0.99);
  });

  it('portão de movimento: a forma segurada (mão parada) não é avaliada; com movimento, lê', () => {
    const rules = { ...DEFAULT_LETTER_RULES, minMotion: 0.1 };
    const rec = createLetterMotionRecognizer(J_CERTO, rules);
    for (let t = 0; t <= 2.1; t += 1 / 15) rec.push(frame(t, [{ h: 'Left', x: 0.4, y: 0.45 }]), 4 / 3);
    expect(rec.windowInputs()).toHaveLength(3);
    expect(rec.evaluate()).toMatchObject({ letter: null, windows: 0 });
    rec.reset();
    for (const f of drawing(0, 2.1)) rec.push(f, 4 / 3);
    expect(rec.evaluate()).toMatchObject({ letter: 'J', windows: 3 });
  });

  it('movimento da janela: pulso em palmos mais a forma da mão; passo sem mão não conta', () => {
    const input = new Float64Array(LETTER_INPUT_DIM);
    input[0] = 1;
    input[2 * LETTER_FRAME_DIM] = 1;
    input[2 * LETTER_FRAME_DIM + 2] = 0.4;
    // passo sem mão com o pulso longe: fica de fora
    input[6 * LETTER_FRAME_DIM + 1] = 9;
    expect(letterWindowMotion(input, 1)).toBeCloseTo(0.4, 9);
    input[2 * LETTER_FRAME_DIM + 4] = 2;
    expect(letterWindowMotion(input, 0.5)).toBeCloseTo(0.4 + 1 / Math.sqrt(21), 9);
  });

  it('teto do "_": sem leitura quando p("_") da janela passa dele', () => {
    const model = tinyModel(['J', '_'], [Math.log(0.7 / 0.3), 0], [0, 0]);
    const leitura = (maxNoneProbability: number) => {
      const rec = createLetterMotionRecognizer(model, { ...DEFAULT_LETTER_RULES, maxNoneProbability });
      for (const f of drawing(0, 2.1)) rec.push(f, 4 / 3);
      return rec.evaluate().letter;
    };
    expect(leitura(1)).toBe('J');
    expect(leitura(0.2)).toBeNull();
  });

  it('"_" mais provável não vira letra', () => {
    const rec = createLetterMotionRecognizer(tinyModel(['J', '_'], [0, 10], [0, -5]));
    for (const f of drawing(0, 2.1)) rec.push(f, 4 / 3);
    expect(rec.evaluate().letter).toBeNull();
  });

  it('abaixo de 0,6 não lê nada (mas a probabilidade aparece para a barra)', () => {
    const rec = createLetterMotionRecognizer(tinyModel(['J', '_'], [0.2, 0], [0, 0]));
    for (const f of drawing(0, 2.1)) rec.push(f, 4 / 3);
    const r = rec.evaluate();
    expect(r.letter).toBeNull();
    expect(r.probs[0]).toBeCloseTo(0.55, 2);
  });

  it('buffer curto: só as janelas que ele cobre', () => {
    const rec = createLetterMotionRecognizer(J_CERTO);
    for (const f of drawing(0, 0.5)) rec.push(f, 1);
    expect(rec.evaluate()).toMatchObject({ letter: null, windows: 0 });
    for (const f of drawing(0.5 + 1 / 15, 0.9)) rec.push(f, 1);
    expect(rec.windowInputs().map(w => w.duration)).toEqual([0.8]);
  });

  it('mão em menos de 60% dos quadros da janela: não avalia', () => {
    const rec = createLetterMotionRecognizer(J_CERTO);
    let i = 0;
    for (let t = 0; t <= 2.1; t += 1 / 15, i++) rec.push(i % 2 ? frame(t, []) : frame(t, [{ h: 'Left', x: 0.4, y: 0.4 }]), 1);
    expect(rec.evaluate().windows).toBe(0);
  });

  it('guarda só os últimos LETTER_BUFFER_S segundos e ignora quadro fora de ordem', () => {
    const rec = createLetterMotionRecognizer(J_CERTO);
    const frames = drawing(0, 4);
    for (const f of frames) rec.push(f, 1);
    const kept = frames.filter(f => f.t >= frames[frames.length - 1].t - LETTER_BUFFER_S).length;
    expect(rec.size()).toBe(kept);
    rec.push(frame(1, [{ h: 'Left', x: 0.4, y: 0.4 }]), 1);
    expect(rec.size()).toBe(kept);
  });

  it('a mão que faz a letra é a mais alta; a mão esquerda da pessoa é espelhada', () => {
    const rec = createLetterMotionRecognizer(J_CERTO);
    // "Right" do MediaPipe (mão esquerda da pessoa) no alto indo para a direita da imagem; "Left" parada embaixo
    for (let t = 0; t <= 1.2; t += 1 / 15) {
      rec.push(frame(t, [{ h: 'Left', x: 0.3, y: 0.9 }, { h: 'Right', x: 0.5 + 0.1 * t, y: 0.4 }]), 1);
    }
    const [w] = rec.windowInputs();
    // presença; o pulso anda para a direita da imagem, espelhado vira x decrescente
    expect(w.input[0]).toBe(1);
    expect(w.input[7 * LETTER_FRAME_DIM + 1]).toBeLessThan(w.input[1]);
    // y do pulso não muda: a mão de baixo não entrou
    expect(Math.abs(w.input[2])).toBeLessThan(1e-9);
  });
});

describe('modelo das letras com movimento em /ml/letras-mov/', () => {
  const valid = {
    format: 'librax-mlp', format_version: 1, normalization_version: 2, input_dim: LETTER_INPUT_DIM,
    labels: ['H', 'J', '_'], kind: 'letras-mov', frames: 8, features_per_frame: 69, window_frames: 24,
    windows_s: [0.8, 1.2, 1.6],
    layers: [{ in: LETTER_INPUT_DIM, out: 3, activation: 'softmax' }],
    weights: { file: 'weights.bin', dtype: 'float32', byte_length: (LETTER_INPUT_DIM * 3 + 3) * 4 },
  };

  function jsonResponse(body: unknown, type = 'application/json') {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': type } });
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setLetterMotionModelForTests(null);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    setLetterMotionModelForTests(null);
  });

  it('confere o contrato do model.json', () => {
    expect(checkLetterMotionModelJson(valid)).toBeNull();
    expect(checkLetterMotionModelJson({ ...valid, kind: 'sinais' })).toMatch(/kind/);
    expect(checkLetterMotionModelJson({ ...valid, normalization_version: 1 })).toMatch(/normalization_version/);
    expect(checkLetterMotionModelJson({ ...valid, features_per_frame: 140 })).toMatch(/janela/);
    expect(checkLetterMotionModelJson({ ...valid, windows_s: [1, 1.5, 2] })).toMatch(/janelas/);
    expect(checkLetterMotionModelJson({ ...valid, input_dim: 10 })).toMatch(/input_dim/);
    expect(checkLetterMotionModelJson({ ...valid, labels: ['H'] })).toMatch(/_/);
    expect(checkLetterMotionModelJson(null)).toMatch(/librax-mlp/);
    expect(checkLetterMotionModelJson({ ...valid, reading_rules: { min_motion: 0.3 } })).toBeNull();
    expect(checkLetterMotionModelJson({ ...valid, reading_rules: { min_motion: -1 } })).toMatch(/min_motion/);
  });

  it('reading_rules do model.json vira as regras do reconhecedor (sem ele, só o limiar)', async () => {
    expect(getLetterMotionReadingRules()).toEqual(DEFAULT_LETTER_RULES);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...valid, reading_rules: { min_motion: 0.3, motion_shape_weight: 1 } })));
    await loadLetterMotionIndex();
    expect(getLetterMotionReadingRules()).toEqual({ ...DEFAULT_LETTER_RULES, minMotion: 0.3 });
  });

  it('sem modelo (404 ou o index.html do servidor de desenvolvimento): nenhuma letra, uma busca por sessão', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadLetterMotionIndex()).size).toBe(0);
    expect((await loadLetterMotionIndex()).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await loadLetterMotionModel()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('com modelo: as letras sem "_"; os pesos só no loadLetterMotionModel', async () => {
    const weights = new ArrayBuffer(valid.weights.byte_length);
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('model.json') ? jsonResponse(valid) : new Response(weights, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect([...(await loadLetterMotionIndex())]).toEqual(['H', 'J']);
    expect([...getMotionLetters()]).toEqual(['H', 'J']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const model = await loadLetterMotionModel();
    expect(model?.labels).toEqual(['H', 'J', '_']);
    expect(fetchMock.mock.calls[1][0]).toBe('/ml/letras-mov/weights.bin');
  });

  it('camera_letters: só as letras que passaram no teste com pessoas nunca vistas vão para a câmera', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...valid, camera_letters: ['J'] })));
    expect([...(await loadLetterMotionIndex())]).toEqual(['J']);
    expect(checkLetterMotionModelJson({ ...valid, camera_letters: 'J' })).toMatch(/camera_letters/);
  });

  it('model.json fora do contrato fica de fora, com aviso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...valid, frames: 12 })));
    expect((await loadLetterMotionIndex()).size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('rede fora: segue sem modelo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect((await loadLetterMotionIndex()).size).toBe(0);
  });
});
