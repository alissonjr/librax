import type { FeedbackItem } from './usageTypes';

/*
 * Comentários já lidos no painel, guardados neste navegador (o painel só lê o servidor). Cada
 * comentário é reconhecido pela hora, pela nota e pelo tamanho do texto, o mesmo que a lista usa como
 * chave; até MAX ficam guardados, os mais antigos saem.
 */

const KEY = 'librax_admin_comentariosLidos';
const MAX = 1000;

export const feedbackKey = (f: Pick<FeedbackItem, 'at' | 'rating' | 'text'>) => `${f.at}|${f.rating}|${f.text.length}`;

function load(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

export function readKeys(): Set<string> {
  return new Set(load());
}

/** Marca os comentários como lidos (os que já estavam continuam). Devolve o conjunto novo. */
export function markRead(items: Array<Pick<FeedbackItem, 'at' | 'rating' | 'text'>>): Set<string> {
  const keys = load();
  const seen = new Set(keys);
  for (const f of items) {
    const k = feedbackKey(f);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  }
  const kept = keys.slice(-MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(kept));
  } catch {
    /* sem armazenamento: vale até fechar a aba */
  }
  return new Set(kept);
}
