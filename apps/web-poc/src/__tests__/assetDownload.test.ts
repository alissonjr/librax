import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetDownloadsForTests, cameraFiles, checkDownload, downloadFiles, downloadPercent, downloadProgress,
  getDownloadState, missingFiles, runDownload, shouldPrefetch, type AssetFile,
} from '../lib/assetDownload';
import { courseGlosses, SIGN_BUNDLE_BYTES, vlibrasFiles } from '../lib/offlinePack';
import { VLIBRAS_BUNDLES_PATH, VLIBRAS_PLAYER_FILES, VLIBRAS_PLAYER_PATH } from '../lib/vlibras';
import signs from '../assets/content/signs.json';

/** Resposta com corpo em pedaços, como a rede entrega. */
function streamResponse(chunks: number[], opts: { length?: number | null; type?: string; status?: number } = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const size of chunks) controller.enqueue(new Uint8Array(size));
      controller.close();
    },
  });
  const total = chunks.reduce((s, n) => s + n, 0);
  const headers = new Headers({ 'content-type': opts.type ?? 'application/octet-stream' });
  if (opts.length !== null) headers.set('content-length', String(opts.length ?? total));
  return new Response(body, { status: opts.status ?? 200, headers });
}

const notCached = async () => false;

describe('shouldPrefetch (baixar sozinho conforme a conexão)', () => {
  it('sem a API de conexão (Safari): baixa', () => {
    expect(shouldPrefetch(undefined)).toBe(true);
  });
  it('economia de dados ligada: não baixa', () => {
    expect(shouldPrefetch({ saveData: true, effectiveType: '4g' })).toBe(false);
  });
  it('2g e slow-2g: não baixa', () => {
    expect(shouldPrefetch({ effectiveType: '2g' })).toBe(false);
    expect(shouldPrefetch({ effectiveType: 'slow-2g' })).toBe(false);
  });
  it('3g e 4g: baixa', () => {
    expect(shouldPrefetch({ effectiveType: '3g', saveData: false })).toBe(true);
    expect(shouldPrefetch({ effectiveType: '4g' })).toBe(true);
  });
});

describe('downloadProgress', () => {
  it('soma os bytes de todos os arquivos', () => {
    expect(downloadProgress([{ loaded: 50, total: 100 }, { loaded: 0, total: 300 }])).toBe(50 / 400);
  });
  it('arquivo que leu mais que o Content-Length (compressão) não passa de 100%', () => {
    expect(downloadProgress([{ loaded: 500, total: 100 }, { loaded: 100, total: 100 }])).toBe(1);
  });
  it('lista vazia está pronta', () => {
    expect(downloadProgress([])).toBe(1);
  });
  it('porcentagem inteira do estado', () => {
    expect(downloadPercent({ status: 'downloading', loaded: 599, total: 1000, error: null })).toBe(59);
    expect(downloadPercent({ status: 'idle', loaded: 0, total: 0, error: null })).toBe(0);
  });
});

describe('downloadFiles', () => {
  const files: AssetFile[] = [
    { url: '/ml/a.wasm', bytes: 1000 },
    { url: '/ml/b.task', bytes: 3000 },
  ];

  it('lê o corpo em stream e avisa o progresso por bytes lidos / Content-Length', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url === '/ml/a.wasm'
      ? streamResponse([400, 400, 200])
      : streamResponse([1500, 1500])));
    const seen: number[] = [];
    await downloadFiles(files, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: notCached,
      onProgress: ({ loaded, total }) => seen.push(loaded / total),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(1);
    // Cresce sem voltar
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(seen).toContain(400 / 4000);
  });

  it('não baixa de novo o que já está no cache (e conta como pronto)', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([3000]));
    const seen: number[] = [];
    await downloadFiles(files, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: async url => url === '/ml/a.wasm',
      onProgress: ({ loaded, total }) => seen.push(loaded / total),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/ml/b.task', expect.anything());
    expect(seen[0]).toBe(1000 / 4000);
  });

  it('sem Content-Length usa o tamanho esperado', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([500], { length: null }));
    const seen: { loaded: number; total: number }[] = [];
    await downloadFiles([{ url: '/ml/a.wasm', bytes: 1000 }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: notCached,
      onProgress: p => seen.push(p),
    });
    expect(seen).toContainEqual({ loaded: 500, total: 1000 });
    expect(seen.at(-1)).toEqual({ loaded: 1000, total: 1000 });
  });

  it('index.html no lugar do arquivo (servidor sem o arquivo) é falha', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([10], { type: 'text/html' }));
    await expect(downloadFiles([{ url: '/ml/a.wasm', bytes: 1000 }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: notCached,
    })).rejects.toThrow('index.html');
  });

  it('arquivo opcional que falha não derruba o resto', async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith('model.json')
      ? streamResponse([1], { status: 404 })
      : streamResponse([1000])));
    await expect(downloadFiles([
      { url: '/ml/a.wasm', bytes: 1000 },
      { url: '/ml/classifier/model.json', bytes: 10, optional: true },
    ], { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: notCached })).resolves.toBeUndefined();
  });

  it('erro HTTP em arquivo obrigatório é falha', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([1], { status: 500 }));
    await expect(downloadFiles(files, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: notCached,
    })).rejects.toThrow('HTTP 500');
  });

  it('arquivo obrigatório que falha para os outros e nenhum progresso chega depois', async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>(r => { release = r; });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/ml/a.wasm') return streamResponse([1], { status: 500 });
      await slow;
      if (init?.signal?.aborted) throw new DOMException('cancelado', 'AbortError');
      return streamResponse([3000]);
    });
    const seen: number[] = [];
    const run = downloadFiles([...files, { url: '/ml/c.bin', bytes: 10 }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      isCached: notCached,
      concurrency: 2,
      onProgress: ({ loaded }) => seen.push(loaded),
    });
    await expect(run).rejects.toThrow('HTTP 500');
    const before = seen.length;
    release();
    await new Promise(r => setTimeout(r, 10));
    expect(seen.length).toBe(before);
    // O terceiro arquivo nem começou
    expect(fetchImpl).not.toHaveBeenCalledWith('/ml/c.bin', expect.anything());
  });

  it('missingFiles devolve só o que falta', async () => {
    const missing = await missingFiles(files, async url => url === '/ml/b.task');
    expect(missing.map(f => f.url)).toEqual(['/ml/a.wasm']);
  });
});

describe('estado dos downloads (selo do mapa e Configurações)', () => {
  const files: AssetFile[] = [{ url: '/ml/a.wasm', bytes: 1000 }, { url: '/ml/b.task', bytes: 1000 }];

  beforeEach(() => {
    __resetDownloadsForTests();
    localStorage.clear();
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { controller: {} } });
    vi.stubGlobal('caches', { match: async () => undefined });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // @ts-expect-error volta ao jsdom sem service worker
    delete navigator.serviceWorker;
  });

  it('tudo no cache: pronto direto, sem passar por "baixando"', async () => {
    const statuses: string[] = [];
    const fetchImpl = vi.fn();
    const { subscribeDownload } = await import('../lib/assetDownload');
    subscribeDownload('camera', () => statuses.push(getDownloadState('camera').status));
    await runDownload('camera', files, { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: async () => true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(statuses).not.toContain('downloading');
    expect(getDownloadState('camera').status).toBe('done');
  });

  it('baixa e termina em "done" com 100%', async () => {
    const fetchImpl = vi.fn(async () => streamResponse([500, 500]));
    await runDownload('offline', files, { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: notCached });
    const state = getDownloadState('offline');
    expect(state.status).toBe('done');
    expect(downloadPercent(state)).toBe(100);
  });

  it('falha vira "error" (e "offline" sem internet)', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await runDownload('offline', files, { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: notCached });
    expect(getDownloadState('offline')).toMatchObject({ status: 'error', error: 'offline' });
  });

  it('sem service worker não baixa: não haveria onde guardar', async () => {
    // @ts-expect-error simula navegador sem service worker
    delete navigator.serviceWorker;
    const fetchImpl = vi.fn();
    await runDownload('offline', files, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getDownloadState('offline')).toMatchObject({ status: 'error', error: 'unsupported' });
  });

  it('opcional que o servidor não tem: pronto depois de um download completo, não antes', async () => {
    const withOptional: AssetFile[] = [...files, { url: '/ml/classifier/model.json', bytes: 10, optional: true }];
    const onlyRequired = async (url: string) => !url.includes('classifier');
    await checkDownload('camera', withOptional, onlyRequired);
    expect(getDownloadState('camera').status).toBe('idle');

    const fetchImpl = vi.fn(async () => streamResponse([1], { status: 404 }));
    await runDownload('camera', withOptional, { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: onlyRequired });
    expect(getDownloadState('camera').status).toBe('done');
    // Na próxima abertura não tenta de novo
    fetchImpl.mockClear();
    __resetDownloadsForTests();
    await runDownload('camera', withOptional, { fetchImpl: fetchImpl as unknown as typeof fetch, isCached: onlyRequired });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getDownloadState('camera').status).toBe('done');
    // Mas obrigatório que saiu do cache conta como faltando
    await checkDownload('camera', withOptional, async url => url === '/ml/a.wasm');
    expect(getDownloadState('camera').status).toBe('idle');
  });

  it('checkDownload: parte no cache mostra quanto falta; tudo no cache, pronto', async () => {
    await checkDownload('offline', files, async url => url === '/ml/a.wasm');
    expect(getDownloadState('offline')).toMatchObject({ status: 'idle', loaded: 1000, total: 2000 });
    await checkDownload('offline', files, async () => true);
    expect(getDownloadState('offline').status).toBe('done');
  });
});

describe('listas de arquivos', () => {
  it('câmera: WASM com SIMD ou sem, modelo e classificador opcional', () => {
    const simd = cameraFiles(true).map(f => f.url);
    expect(simd).toContain('/ml/1.1.1/wasm/vision_wasm_internal.wasm');
    expect(simd).toContain('/ml/1.1.1/hand_landmarker.task');
    expect(cameraFiles(false).map(f => f.url)).toContain('/ml/1.1.1/wasm/vision_wasm_nosimd_internal.wasm');
    expect(cameraFiles(true).filter(f => f.optional).map(f => f.url)).toEqual(['/ml/classifier/model.json', '/ml/classifier/weights.bin']);
  });

  it('câmera: corpo e modelo dos sinais com movimento só quando há modelo de sinais', () => {
    const without = cameraFiles(true).map(f => f.url);
    expect(without.some(u => u.includes('pose') || u.startsWith('/ml/sinais/'))).toBe(false);
    const withSigns = cameraFiles(true, true);
    expect(withSigns.slice(0, without.length).map(f => f.url)).toEqual(without);
    expect(withSigns.slice(without.length).map(f => [f.url, !!f.optional])).toEqual([
      ['/ml/1.1.1/pose_landmarker_lite.task', false],
      ['/ml/sinais/model.json', true],
      ['/ml/sinais/weights.bin', true],
    ]);
  });

  it('glosas do curso: as mesmas do scripts/vlibras-assets.mjs (compostas separadas, sem repetir)', () => {
    const glosses = courseGlosses([
      { avatar: { provider: 'vlibras', gloss: 'BOM DIA' } },
      { avatar: { provider: 'vlibras', gloss: 'BOM' } },
      { avatar: { provider: 'vlibras', gloss: null } },
      { avatar: null },
      {},
    ]);
    expect(glosses).toEqual(['BOM', 'DIA']);
    // O curso de verdade tem as cerca de 250 animações que o script copia
    expect(courseGlosses(signs as never).length).toBeGreaterThan(200);
  });

  it('VLibras: player e animações; glosa com "&" também no endereço que o Unity pede', () => {
    const files = vlibrasFiles(['MÃE', 'ACORDAR&DESPERTAR']);
    const urls = files.map(f => f.url);
    expect(urls.slice(0, VLIBRAS_PLAYER_FILES.length)).toEqual(VLIBRAS_PLAYER_FILES.map(f => VLIBRAS_PLAYER_PATH + f.name));
    expect(urls).toContain(`${VLIBRAS_BUNDLES_PATH}M%C3%83E`);
    expect(urls).toContain(`${VLIBRAS_BUNDLES_PATH}ACORDAR%26DESPERTAR`);
    expect(urls).toContain(`${VLIBRAS_BUNDLES_PATH}ACORDAR&DESPERTAR`);
    expect(urls.filter(u => u.includes('M%C3%83E'))).toHaveLength(1);
    expect(files.at(-1)?.bytes).toBe(SIGN_BUNDLE_BYTES);
  });

  // Os tamanhos fixados servem para a estimativa antes de baixar; confere com os arquivos gerados
  // (public/ml e public/vlibras só existem depois do predev/prebuild)
  it('tamanhos fixados batem com os arquivos gerados', async (ctx) => {
    const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as {
      existsSync(path: URL): boolean;
      statSync(path: URL): { size: number };
    };
    // Base numa variável: com import.meta.url direto no new URL o Vite troca por um glob de assets
    const here = import.meta.url;
    const publicFile = (url: string) => new URL(`../../public${url}`, here);
    if (!fs.existsSync(publicFile('/ml/1.1.1/'))) ctx.skip();
    const sized = [
      ...cameraFiles(true, true), ...cameraFiles(false),
      ...VLIBRAS_PLAYER_FILES.map(f => ({ url: VLIBRAS_PLAYER_PATH + f.name, bytes: f.bytes, optional: false })),
    ].filter(f => !f.optional);
    for (const f of sized) {
      if (fs.existsSync(publicFile(f.url))) expect([f.url, fs.statSync(publicFile(f.url)).size]).toEqual([f.url, f.bytes]);
    }
  });
});
