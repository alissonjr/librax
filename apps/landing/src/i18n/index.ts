import type { Locale } from '../locale';
import { pt, type Copy } from './pt';
import { en } from './en';
import { es } from './es';

export type { Copy };

export const COPY: Record<Locale, Copy> = { 'pt-BR': pt, en, es };

/** Troca {chave} pelo valor. Chave sem valor fica como está (o teste acusa). */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

/** Número no formato do idioma: 6,4 no português e no espanhol, 6.4 no inglês. */
export function formatNumber(locale: Locale, n: number, digits = 0): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Data AAAA-MM-DD por extenso no idioma (25 de outubro de 2026). */
export function formatDate(locale: Locale, iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}
