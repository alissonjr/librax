import type { ResourceLoad } from './summary';

/**
 * Lê no Resource Timing quanto um arquivo de ML levou para chegar e de onde veio.
 * O MediaPipe baixa o WASM e o modelo por fetch, então as entradas aparecem aqui.
 */
export function findResource(path: RegExp, since: number): ResourceLoad | null {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) return null;
  const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const hit = entries
    .filter(e => e.startTime >= since - 1 && path.test(safePath(e.name)))
    .pop();
  if (!hit) return null;

  let source: ResourceLoad['source'];
  if (hit.workerStart > 0) source = 'service worker';
  else if (typeof hit.transferSize !== 'number') source = 'n/d';
  else if (hit.transferSize === 0 && hit.decodedBodySize > 0) source = 'cache HTTP';
  else if (hit.transferSize === 0) source = 'n/d';
  else source = 'rede';

  const kb = typeof hit.transferSize === 'number' && hit.transferSize > 0 ? hit.transferSize / 1024 : null;
  return { ms: hit.duration, source, kb };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Sem isto o navegador para de guardar entradas depois de 250 (o padrão). */
export function enlargeResourceBuffer(): void {
  try {
    performance.setResourceTimingBufferSize?.(1000);
  } catch {
    /* sem suporte */
  }
}
