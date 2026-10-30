import type { AdminApi } from './api';
import type { FeedbackItem } from './usageTypes';

/**
 * Arquivo único para calibrar o app (reconhecimento, exercícios e conteúdo) fora do painel.
 *
 * Junta o que o painel já mostra, sem dado de conta nenhuma:
 * - `operation`: GET /v1/admin/overview?days=90 (lições, exercícios, sinais errados, desistências e o
 *   desempenho da câmera por letra e sinal, com as leituras trocadas), somando todas as pessoas;
 * - `usage`: GET /v1/admin/usage (dados de uso anônimos consolidados: funil, retenção, lições,
 *   prática, plataformas e o resumo das notas);
 * - `feedback`: todas as notas com comentário (GET /v1/admin/feedback, página por página), sem o
 *   código anônimo de quem mandou;
 * - `content`: GET /v1/admin/content (o catálogo: tipo de reconhecimento de cada sinal, unidade e
 *   lição), para ligar os ids dos números ao sinal.
 */

export const EXPORT_VERSION = 1;
export const EXPORT_DAYS = 90;
/** Limite de páginas de notas (a rota devolve uma página por vez). */
export const FEEDBACK_MAX_PAGES = 100;

export interface CalibrationExport {
  kind: 'librax-calibracao';
  version: number;
  exportedAt: string;
  windowDays: number;
  operation: Awaited<ReturnType<AdminApi['overview']>>;
  usage: Awaited<ReturnType<AdminApi['usage']>>;
  feedback: { items: FeedbackItem[]; truncated: boolean };
  content: Awaited<ReturnType<AdminApi['content']>>;
}

async function allFeedback(api: AdminApi): Promise<{ items: FeedbackItem[]; truncated: boolean }> {
  const items: FeedbackItem[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < FEEDBACK_MAX_PAGES; page++) {
    const res = await api.feedback({ cursor });
    items.push(...res.items);
    cursor = res.cursor;
    if (!cursor) return { items, truncated: false };
  }
  return { items, truncated: true };
}

export async function buildCalibrationExport(api: AdminApi, now: () => Date = () => new Date()): Promise<CalibrationExport> {
  const [operation, usage, feedback, content] = await Promise.all([
    api.overview(EXPORT_DAYS),
    api.usage(),
    allFeedback(api),
    api.content(),
  ]);
  return {
    kind: 'librax-calibracao',
    version: EXPORT_VERSION,
    exportedAt: now().toISOString(),
    windowDays: EXPORT_DAYS,
    operation,
    usage,
    feedback,
    content,
  };
}

/** Nome do arquivo: librax-calibracao-AAAA-MM-DD.json (dia de quem baixou). */
export function exportFileName(at: Date): string {
  const d = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return `librax-calibracao-${d}.json`;
}

/** Entrega o arquivo para o navegador salvar. */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
