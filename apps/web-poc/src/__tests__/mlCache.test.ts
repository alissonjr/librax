import { describe, expect, it } from 'vitest';
import { ML_ROUTES, mlRouteFor } from '../lib/mlCache';
import {
  CLASSIFIER_DIR, HAND_MODEL_URL, LETTER_MOTION_DIR, MEDIAPIPE_WASM_URL, NUMBERS_DIR, POSE_MODEL_URL, SIGN_MODEL_DIR,
} from '../recognition/mlAssets';
import { cameraFiles } from '../lib/assetDownload';

const ORIGEM = 'https://app.librax.online';

describe('cache do service worker em /ml/', () => {
  it('com versão no caminho: CacheFirst, no cache do MediaPipe', () => {
    for (const url of [MEDIAPIPE_WASM_URL, HAND_MODEL_URL, POSE_MODEL_URL]) {
      const r = mlRouteFor(ORIGEM + url);
      expect(r, url).toMatchObject({ versioned: true, cacheName: 'librax-ml-v1' });
    }
  });

  it('pastas de modelo sem versão: StaleWhileRevalidate, cada uma no cache que já existia', () => {
    const esperado: Record<string, string> = {
      [CLASSIFIER_DIR]: 'librax-classifier-v1',
      [SIGN_MODEL_DIR]: 'librax-sinais-v1',
      [LETTER_MOTION_DIR]: 'librax-letras-mov-v1',
      [NUMBERS_DIR]: 'librax-numeros-v1',
    };
    for (const [dir, cacheName] of Object.entries(esperado)) {
      for (const arquivo of ['model.json', 'weights.bin']) {
        expect(mlRouteFor(`${ORIGEM}${dir}/${arquivo}`), `${dir}/${arquivo}`).toMatchObject({ versioned: false, cacheName });
      }
    }
  });

  it('outra pasta sem versão também revalida; parecido com versão não vira imutável', () => {
    expect(mlRouteFor(`${ORIGEM}/ml/expressoes/model.json`)).toMatchObject({ versioned: false, cacheName: 'librax-ml-modelos-v1' });
    expect(mlRouteFor(`${ORIGEM}/ml/1.1/model.json`)?.versioned).toBe(false);
    expect(mlRouteFor(`${ORIGEM}/ml/v1.1.1/model.json`)?.versioned).toBe(false);
    expect(mlRouteFor(`${ORIGEM}/ml/classifierx/model.json`)?.cacheName).toBe('librax-ml-modelos-v1');
  });

  it('fora de /ml/ nenhuma regra de ML', () => {
    for (const url of ['/', '/licao/u1-l1', '/assets/main.js', '/vlibras/sinais/2018.3.1/CASA', '/api/ml/x', '/content/ml/1.1.1/a']) {
      expect(mlRouteFor(ORIGEM + url), url).toBeNull();
    }
  });

  it('todo arquivo do pacote offline da câmera tem regra (senão não funciona offline)', () => {
    for (const f of [...cameraFiles(true, true), ...cameraFiles(false, true)]) {
      expect(mlRouteFor(ORIGEM + f.url), f.url).not.toBeNull();
    }
  });

  it('nomes de cache únicos', () => {
    const nomes = ML_ROUTES.map((r) => r.cacheName);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});
