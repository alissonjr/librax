import { toJsonl, type CaptureSample } from './sample';

export type ExportResult = 'shared' | 'downloaded' | 'cancelled' | 'empty';

export function exportFileName(personId: string, at = new Date()): string {
  const safe = personId.replace(/[^a-zA-Z0-9_-]/g, '') || 'pessoa';
  const stamp = at.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `librax-coleta-${safe}-${stamp}.jsonl`;
}

/**
 * Entrega o JSONL: pela folha de compartilhar do sistema (Web Share com arquivo, iPhone e
 * Android) quando existe, senão baixando o arquivo.
 */
export async function exportSamples(samples: readonly CaptureSample[], personId: string): Promise<ExportResult> {
  if (samples.length === 0) return 'empty';
  const name = exportFileName(personId);
  const blob = new Blob([toJsonl(samples)], { type: 'application/x-ndjson' });
  const file = new File([blob], name, { type: 'application/x-ndjson' });

  const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Coleta Librax' });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return 'cancelled';
      // Compartilhamento recusado: cai para o download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
