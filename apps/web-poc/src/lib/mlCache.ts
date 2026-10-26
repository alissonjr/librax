/**
 * Cache do service worker para os arquivos de ML em /ml/ (vite.config.ts, runtimeCaching). Fica
 * aqui para ter teste. Mesma regra do CloudFront (infra/lib/librax-stack.ts):
 *
 * - /ml/<versão>/ (WASM e modelos do MediaPipe, scripts/ml-assets.mjs): a versão está no caminho,
 *   então o que foi baixado vale para sempre (CacheFirst; cache imutável no navegador e na borda).
 * - Pastas sem versão (classificador das letras, sinais, letras com movimento, números e qualquer
 *   outra que aparecer): o mesmo endereço recebe modelo novo a cada publicação. O service worker
 *   entrega o guardado (funciona offline) e busca o novo por trás (StaleWhileRevalidate); o
 *   CloudFront manda `no-cache`, então essa busca revalida com o ETag e nunca para num cache HTTP
 *   antigo. O modelo novo vale a partir da abertura seguinte.
 *
 * Os padrões são RegExp (e não funções) porque o Workbox copia cada regra como texto para o sw.js
 * gerado: uma função não poderia usar nada deste módulo. O Workbox testa a RegExp contra o endereço
 * inteiro (com a origem).
 */

export interface MlRoute {
  pattern: RegExp;
  cacheName: string;
  /** Caminho com versão: CacheFirst. Sem versão: StaleWhileRevalidate. */
  versioned: boolean;
  maxEntries: number;
}

/** Pastas sem versão conhecidas. Os nomes de cache são os já publicados: trocar perde o offline. */
export const ML_MODEL_DIRS: ReadonlyArray<{ dir: string; cacheName: string }> = [
  { dir: 'classifier', cacheName: 'librax-classifier-v1' },
  { dir: 'sinais', cacheName: 'librax-sinais-v1' },
  { dir: 'letras-mov', cacheName: 'librax-letras-mov-v1' },
  { dir: 'numeros', cacheName: 'librax-numeros-v1' },
];

const ORIGIN = String.raw`^[a-z][a-z0-9+.-]*:\/\/[^/]+`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/** Ordem importa: o Workbox usa a primeira regra que casa. */
export const ML_ROUTES: readonly MlRoute[] = [
  { pattern: new RegExp(`${ORIGIN}\\/ml\\/\\d+\\.\\d+\\.\\d+\\/`), cacheName: 'librax-ml-v1', versioned: true, maxEntries: 8 },
  ...ML_MODEL_DIRS.map(({ dir, cacheName }) => ({
    pattern: new RegExp(`${ORIGIN}\\/ml\\/${escape(dir)}\\/`),
    cacheName,
    versioned: false,
    maxEntries: 4,
  })),
  // Qualquer outra pasta sem versão que vier depois
  { pattern: new RegExp(`${ORIGIN}\\/ml\\/[^?#]+`), cacheName: 'librax-ml-modelos-v1', versioned: false, maxEntries: 16 },
];

/** Regra que o service worker aplica a um endereço (a primeira que casa), ou null fora de /ml/. */
export function mlRouteFor(href: string): MlRoute | null {
  return ML_ROUTES.find((r) => r.pattern.test(href)) ?? null;
}
