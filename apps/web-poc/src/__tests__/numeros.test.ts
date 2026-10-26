import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkNumberModelJson, getCameraNumbers, loadNumberClassifier, loadNumberIndex, setNumberClassifierForTests,
} from '../recognition/numberModel';
import { createMlpClassifier } from '../recognition/classifier';
import type { MlpModel } from '../recognition/mlp';
import {
  course, isNumberEvaluable, resolveExercises, signsMap, type BundleExercise, type Sign,
} from '../lib/content';
import u2l1 from '../assets/content/lessons/u2-l1.json';
import u2l2 from '../assets/content/lessons/u2-l2.json';
import u13l1 from '../assets/content/lessons/u13-l1.json';

const LABELS = ['0', '1', '2', '_'];
const valid = {
  format: 'librax-mlp', format_version: 1, normalization_version: 2, input_dim: 65, kind: 'numeros',
  labels: LABELS, camera_numbers: ['0', '2'],
  layers: [{ in: 65, out: 4, activation: 'softmax' }],
  weights: { file: 'weights.bin', dtype: 'float32', byte_length: (65 * 4 + 4) * 4 },
};

function jsonResponse(body: unknown, type = 'application/json') {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': type } });
}

const fakeClassifier = () =>
  createMlpClassifier({ labels: LABELS, normalizationVersion: 2, inputDim: 65, layers: [] } as MlpModel);

describe('modelo dos números em /ml/numeros/', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    setNumberClassifierForTests(null);
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    warn.mockRestore();
    setNumberClassifierForTests(null);
  });

  it('confere o contrato do model.json', () => {
    expect(checkNumberModelJson(valid)).toBeNull();
    expect(checkNumberModelJson({ ...valid, kind: 'letras-mov' })).toMatch(/kind/);
    expect(checkNumberModelJson({ ...valid, normalization_version: 1 })).toMatch(/normalization_version/);
    expect(checkNumberModelJson({ ...valid, input_dim: 552 })).toMatch(/input_dim/);
    expect(checkNumberModelJson({ ...valid, labels: ['0', '1'] })).toMatch(/_/);
    expect(checkNumberModelJson({ ...valid, camera_numbers: undefined })).toMatch(/camera_numbers/);
    expect(checkNumberModelJson(null)).toMatch(/librax-mlp/);
  });

  it('o model.json publicado segue o contrato e só põe na câmera números do modelo', () => {
    const [published] = Object.values(import.meta.glob<Record<string, unknown>>(
      '../../public/ml/numeros/model.json', { eager: true, import: 'default' },
    ));
    expect(checkNumberModelJson(published)).toBeNull();
    const camera = published.camera_numbers as string[];
    expect(camera.length).toBeGreaterThan(0);
    for (const n of camera) {
      expect(n).toMatch(/^[0-9]$/);
      expect(published.labels).toContain(n);
    }
  });

  it('sem modelo (404 ou o index.html do servidor de desenvolvimento): nenhum número, uma busca por sessão', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await loadNumberIndex()).size).toBe(0);
    expect((await loadNumberIndex()).size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await loadNumberClassifier()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('com modelo: só camera_numbers na câmera; os pesos só no loadNumberClassifier', async () => {
    const weights = new ArrayBuffer(valid.weights.byte_length);
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('model.json') ? jsonResponse(valid) : new Response(weights, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect([...(await loadNumberIndex())]).toEqual(['0', '2']);
    expect([...getCameraNumbers()]).toEqual(['0', '2']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const clf = await loadNumberClassifier();
    expect(fetchMock.mock.calls[1][0]).toBe('/ml/numeros/weights.bin');
    expect(clf?.kind).toBe('mlp');
    expect([...(clf?.letters ?? [])]).toEqual(['0', '2']);
  });

  it('model.json fora do contrato: nenhum número', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...valid, kind: 'sinais' })));
    expect((await loadNumberIndex()).size).toBe(0);
  });
});

describe('perform_sign dos números com o modelo dos números', () => {
  afterEach(() => setNumberClassifierForTests(null));
  const lesson = (id: string) => course.lessonsMap[id];
  const performed = (items: BundleExercise[], signIds: string[]) =>
    resolveExercises(items, signIds, { canEvaluate: () => false, canEvaluateMotion: () => false })
      .filter((e) => e.type === 'perform_sign' || e.type === 'mirror_practice')
      .map((e) => [e.signId, e.type, e.recognizer]);

  it('sem modelo publicado nada muda: os números são prática livre', () => {
    expect(isNumberEvaluable(signsMap['numero-0'])).toBe(false);
    const out = performed(u2l1.exercises as BundleExercise[], lesson('u2-l1').signIds);
    expect(out.filter(([, type]) => type === 'perform_sign')).toEqual([]);
    expect(out.map(([id]) => id)).toContain('numero-0');
  });

  it('número em camera_numbers vira perform_sign com o recognizer "numeros"; os outros seguem prática livre', () => {
    setNumberClassifierForTests({ classifier: fakeClassifier(), numbers: ['0', '2'] });
    expect(isNumberEvaluable(signsMap['numero-0'])).toBe(true);
    expect(isNumberEvaluable(signsMap['numero-1'])).toBe(false);
    // só a categoria dos números: uma letra ou um sinal com a mesma glosa não entra
    const letra = { ...signsMap['numero-0'], id: 'x', category: 'alfabeto' } as Sign;
    expect(isNumberEvaluable(letra)).toBe(false);
    const out = performed(u2l1.exercises as BundleExercise[], lesson('u2-l1').signIds);
    expect(out).toContainEqual(['numero-0', 'perform_sign', 'numeros']);
    expect(out.filter(([id]) => id === 'numero-1').map(([, type]) => type)).toEqual(['mirror_practice']);
    // 6 e 7 fora de camera_numbers; 11 e 12 são números compostos, com glosas que o modelo não tem
    for (const [id, items] of [['u2-l2', u2l2], ['u13-l1', u13l1]] as const) {
      const rest = performed(items.exercises as BundleExercise[], lesson(id).signIds);
      expect(rest.filter(([, type]) => type === 'perform_sign')).toEqual([]);
    }
  });

  it('a opção canEvaluateNumber decide no lugar do modelo', () => {
    const ex = resolveExercises(u2l1.exercises as BundleExercise[], lesson('u2-l1').signIds, {
      canEvaluate: () => false, canEvaluateMotion: () => false, canEvaluateNumber: (s) => s?.gloss === '1',
    });
    expect(ex.filter((e) => e.type === 'perform_sign').map((e) => [e.signId, e.recognizer]))
      .toEqual([['numero-1', 'numeros']]);
  });
});
