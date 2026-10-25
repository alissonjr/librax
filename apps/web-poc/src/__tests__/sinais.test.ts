import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Lm } from '../lib/recognizer';
import type { MlpModel } from '../recognition/mlp';
import { PER_HAND, SIGN_FRAME_DIM, SIGN_INPUT_DIM, type SignFrame } from '../recognition/signFeatures';
import {
  checkSignModelJson, getSignGlosses, hasSignModel, loadSignIndex, loadSignModel, setSignModelForTests,
} from '../recognition/signModel';
import { BUFFER_S, createSignRecognizer, probabilityOf } from '../recognition/signRecognizer';

/** Corpo de frente: nariz em cima, ombros a 0,25 de largura. */
function pose(): Lm[] {
  const p: Lm[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.8, z: 0 }));
  p[0] = { x: 0.5, y: 0.3, z: 0 };
  p[11] = { x: 0.62, y: 0.55, z: 0 };
  p[12] = { x: 0.38, y: 0.55, z: 0 };
  return p;
}

/** Mão aberta com o pulso em (x, y). */
function hand(x: number, y: number): Lm[] {
  return Array.from({ length: 21 }, (_, i) => ({ x: x + ((i % 5) - 2) * 0.01, y: y - 0.01 - Math.floor(i / 5) * 0.015, z: 0 }));
}

function frame(t: number, hands: { h: string; x: number; y: number }[], withPose = true): SignFrame {
  return { t, hands: hands.map(m => ({ handedness: m.h, landmarks: hand(m.x, m.y) })), pose: withPose ? pose() : null };
}

/**
 * MLP de uma camada só (softmax) com logit(rótulo) = w * presença da dominante no último quadro
 * do modelo + b. Dá para escolher a probabilidade de cada rótulo com a mão no quadro.
 */
function tinyModel(labels: string[], weights: number[], bias: number[]): MlpModel {
  const n = labels.length;
  const kernel = new Float32Array(SIGN_INPUT_DIM * n);
  const lastFramePresence = 7 * SIGN_FRAME_DIM;
  weights.forEach((w, j) => { kernel[lastFramePresence * n + j] = w; });
  return {
    labels,
    normalizationVersion: 2,
    inputDim: SIGN_INPUT_DIM,
    layers: [{ in: SIGN_INPUT_DIM, out: n, activation: 'softmax', kernel, bias: Float32Array.from(bias) }],
  };
}

/** Quadros de t0 a t1 (s) a 15 fps com a mão subindo e descendo perto do rosto. */
function signing(t0: number, t1: number, h = 'Left'): SignFrame[] {
  const out: SignFrame[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 15) out.push(frame(t, [{ h, x: 0.4 + 0.05 * Math.sin(t * 6), y: 0.45 }]));
  return out;
}

const MESA_CERTA = tinyModel(['MESA', '_'], [10, 0], [-5, 0]);

describe('reconhecedor de sinais com movimento', () => {
  it('lê a glosa quando o modelo passa do limiar e não é "_"', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    for (const f of signing(0, 2.2)) rec.push(f, 4 / 3);
    const r = rec.evaluate();
    expect(r.windows).toBe(3);
    expect(r.gloss).toBe('MESA');
    expect(r.probability).toBeGreaterThan(0.99);
    expect(probabilityOf(r, rec.labels, 'MESA')).toBe(r.probability);
    expect(probabilityOf(r, rec.labels, 'ARROZ')).toBe(0);
  });

  it('"_" mais provável não vira sinal', () => {
    const rec = createSignRecognizer(tinyModel(['MESA', '_'], [0, 10], [0, -5]));
    for (const f of signing(0, 2.2)) rec.push(f, 4 / 3);
    expect(rec.evaluate().gloss).toBeNull();
  });

  it('abaixo de 0,6 não lê nada (mas a probabilidade aparece para a barra)', () => {
    // logit 0,2 contra 0: p = 0,55
    const rec = createSignRecognizer(tinyModel(['MESA', '_'], [0.2, 0], [0, 0]));
    for (const f of signing(0, 2.2)) rec.push(f, 4 / 3);
    const r = rec.evaluate();
    expect(r.gloss).toBeNull();
    expect(probabilityOf(r, rec.labels, 'MESA')).toBeCloseTo(0.55, 2);
  });

  it('buffer curto: só as janelas que ele cobre', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    for (const f of signing(0, 0.5)) rec.push(f, 1);
    expect(rec.windowInputs()).toHaveLength(0);
    expect(rec.evaluate()).toMatchObject({ gloss: null, windows: 0 });
    for (const f of signing(0.5 + 1 / 15, 1.2)) rec.push(f, 1);
    expect(rec.windowInputs().map(w => w.duration)).toEqual([1]);
  });

  it('janela sem mão levantada não é avaliada (mão baixa ou sem mão)', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    // pulso bem abaixo dos ombros: 0,55 + 2 larguras de ombro
    for (let t = 0; t <= 2.2; t += 1 / 15) rec.push(frame(t, [{ h: 'Left', x: 0.4, y: 0.55 + 0.24 * 2 }]), 1);
    expect(rec.evaluate()).toMatchObject({ gloss: null, windows: 0 });
    rec.reset();
    for (let t = 0; t <= 2.2; t += 1 / 15) rec.push(frame(t, []), 1);
    expect(rec.evaluate().windows).toBe(0);
  });

  it('guarda só os últimos BUFFER_S segundos e ignora quadro fora de ordem', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    const frames = signing(0, 4);
    for (const f of frames) rec.push(f, 1);
    const kept = frames.filter(f => f.t >= frames[frames.length - 1].t - BUFFER_S).length;
    expect(rec.size()).toBe(kept);
    rec.push(frame(1, [{ h: 'Left', x: 0.4, y: 0.4 }]), 1);
    expect(rec.size()).toBe(kept);
  });

  it('dominante é a mão que mais se mexe no buffer; a outra vai para a segunda vaga', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    // "Right" do MediaPipe (mão esquerda da pessoa) se mexe; "Left" fica parada embaixo
    for (let t = 0; t <= 2.2; t += 1 / 15) {
      rec.push(frame(t, [{ h: 'Left', x: 0.35, y: 0.7 }, { h: 'Right', x: 0.6 + 0.05 * Math.sin(t * 6), y: 0.45 }]), 1);
    }
    const [w] = rec.windowInputs();
    // dominante espelhada: o pulso à direita do meio dos ombros vira x negativo
    expect(w.input[0]).toBe(1);
    expect(w.input[1]).toBeLessThan(0);
    expect(w.input[PER_HAND]).toBe(1);
    expect(w.input[PER_HAND + 2]).toBeGreaterThan(0.5);
  });

  it('sem movimento nenhum, vale o rótulo que mais aparece (não a vaga da outra)', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    for (let t = 0; t <= 1.2; t += 1 / 15) rec.push(frame(t, [{ h: 'Right', x: 0.6, y: 0.45 }]), 1);
    const [w] = rec.windowInputs();
    expect(w.input[0]).toBe(1);
    expect(w.input[PER_HAND]).toBe(0);
  });

  it('quadros sem corpo entram como zero', () => {
    const rec = createSignRecognizer(MESA_CERTA);
    for (let t = 0; t <= 1.2; t += 1 / 15) rec.push(frame(t, [{ h: 'Left', x: 0.4, y: 0.45 }], t < 1), 1);
    const [w] = rec.windowInputs();
    expect(w.input[7 * SIGN_FRAME_DIM]).toBe(0);
    expect(w.input[0]).toBe(1);
  });
});

describe('modelo de sinais publicado em /ml/sinais/', () => {
  const valid = {
    format: 'librax-mlp', format_version: 1, normalization_version: 2, input_dim: SIGN_INPUT_DIM,
    labels: ['ARROZ', 'MESA', '_'], kind: 'sinais', frames: 8, features_per_frame: 140, window_frames: 24,
    layers: [{ in: SIGN_INPUT_DIM, out: 3, activation: 'softmax' }],
    weights: { file: 'weights.bin', dtype: 'float32', byte_length: (SIGN_INPUT_DIM * 3 + 3) * 4 },
  };

  function jsonResponse(body: unknown, type = 'application/json') {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': type } });
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setSignModelForTests(null);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    setSignModelForTests(null);
  });

  it('confere o contrato do model.json', () => {
    expect(checkSignModelJson(valid)).toBeNull();
    expect(checkSignModelJson({ ...valid, kind: undefined })).toMatch(/kind/);
    expect(checkSignModelJson({ ...valid, normalization_version: 1 })).toMatch(/normalization_version/);
    expect(checkSignModelJson({ ...valid, frames: 12 })).toMatch(/janela/);
    expect(checkSignModelJson({ ...valid, input_dim: 10 })).toMatch(/input_dim/);
    expect(checkSignModelJson({ ...valid, labels: ['ARROZ'] })).toMatch(/_/);
    expect(checkSignModelJson(null)).toMatch(/librax-mlp/);
  });

  it('sem modelo (404 ou o index.html do servidor de desenvolvimento): nenhuma glosa, uma busca por sessão', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadSignIndex()).size).toBe(0);
    expect((await loadSignIndex()).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hasSignModel()).toBe(false);
    expect(await loadSignModel()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('com modelo: as glosas sem "_"; os pesos só no loadSignModel', async () => {
    const weights = new ArrayBuffer(valid.weights.byte_length);
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('model.json') ? jsonResponse(valid) : new Response(weights, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect([...(await loadSignIndex())]).toEqual(['ARROZ', 'MESA']);
    expect([...getSignGlosses()]).toEqual(['ARROZ', 'MESA']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const model = await loadSignModel();
    expect(model?.labels).toEqual(['ARROZ', 'MESA', '_']);
    expect(fetchMock.mock.calls[1][0]).toBe('/ml/sinais/weights.bin');
  });

  it('model.json fora do contrato fica de fora, com aviso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...valid, features_per_frame: 99 })));
    expect((await loadSignIndex()).size).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('rede fora: segue sem modelo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    expect((await loadSignIndex()).size).toBe(0);
  });
});
