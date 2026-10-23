// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest';
import modelJson from '../recognition/__fixtures__/paridade/model.json';
import golden from '../recognition/__fixtures__/paridade/golden.json';
import { getClassifier, HEURISTIC_LETTERS, loadClassifier, setClassifierForTests } from '../recognition/classifier';

async function readWeights(): Promise<ArrayBuffer> {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as { readFileSync(path: URL): Uint8Array };
  const bytes = fs.readFileSync(new URL('../recognition/__fixtures__/paridade/weights.bin', import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function respond(body: unknown, contentType: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => body,
    arrayBuffer: async () => body as ArrayBuffer,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  setClassifierForTests(null);
  vi.restoreAllMocks();
});

describe('escolha do classificador', () => {
  it('sem /ml/classifier/model.json fica no heurístico', async () => {
    const fetchMock = vi.fn(async () => respond('não encontrado', 'text/plain', 404));
    vi.stubGlobal('fetch', fetchMock);
    setClassifierForTests(null);
    const c = await loadClassifier();
    expect(c.kind).toBe('heuristic');
    expect(c.letters).toBe(HEURISTIC_LETTERS);
    expect(fetchMock).toHaveBeenCalledWith('/ml/classifier/model.json', { headers: { Accept: 'application/json' } });
  });

  it('index.html no lugar do JSON (fallback de SPA) não é confundido com modelo', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respond('<!doctype html>', 'text/html')));
    setClassifierForTests(null);
    expect((await loadClassifier()).kind).toBe('heuristic');
  });

  it('com model.json e weights.bin usa o MLP e as letras dele', async () => {
    const weights = await readWeights();
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('model.json') ? respond(modelJson, 'application/json') : respond(weights, 'application/octet-stream')));
    setClassifierForTests(null);
    const c = await loadClassifier();
    expect(c.kind).toBe('mlp');
    expect([...c.letters]).toEqual(['A', 'B', 'L']);
    expect(getClassifier()).toBe(c);

    // Mesmo resultado do vetor dourado, a partir dos landmarks brutos
    const g = golden.cases[0];
    const lms = Array.from({ length: 21 }, (_, i) => ({ x: g.raw[i * 3], y: g.raw[i * 3 + 1], z: g.raw[i * 3 + 2] }));
    const out = c.classify(lms, { handedness: g.handedness, aspect: g.aspect });
    const best = Math.max(...g.probs);
    expect(out.letter).toBe(golden.labels[g.probs.indexOf(best)]);
    expect(out.confidence).toBeCloseTo(best, 6);
  });

  it('modelo de outra normalization_version é recusado', async () => {
    const weights = await readWeights();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      url.endsWith('model.json')
        ? respond({ ...modelJson, normalization_version: 99 }, 'application/json')
        : respond(weights, 'application/octet-stream')));
    setClassifierForTests(null);
    expect((await loadClassifier()).kind).toBe('heuristic');
    expect(warn).toHaveBeenCalled();
  });
});
