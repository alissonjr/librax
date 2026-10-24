// Números e datas em pt-BR.

const int = new Intl.NumberFormat('pt-BR');
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const fmtInt = (n: number | null | undefined) => (n == null ? '-' : int.format(n));
export const fmtPct = (r: number | null | undefined) => (r == null ? '-' : pct.format(r));

/** Dólares com centavos: "US$ 1,23". */
export function fmtUsd(n: number | null | undefined, currency = 'USD'): string {
  if (n == null) return '-';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
}

/** '2026-10-23' -> '23 out' */
export function fmtDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
}

/** '2026-10' -> 'out 2026' */
export function fmtMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** '2026-w43' -> 'sem 43' */
export function fmtWeek(week: string): string {
  return `sem ${Number(week.split('-w')[1])}`;
}

/** ISO completo -> '23 out 2026, 12:30' (hora de Brasília). */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  }).format(d).replace('.', '');
}

/** ISO -> '23 out 2026' */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' })
    .format(d).replace('.', '');
}

/** Nome dos tipos de exercício (apps/web-poc/src/lib/content.ts). */
export const EXERCISE_LABELS: Record<string, string> = {
  sign_intro: 'Apresentação do sinal',
  perform_sign: 'Fazer o sinal na câmera',
  watch_choose_word: 'Ver o sinal e escolher a palavra',
  word_choose_video: 'Ver a palavra e escolher o sinal',
  match_pairs: 'Relacionar pares',
  order_sequence: 'Ordenar a sequência',
  build_phrase: 'Montar a frase',
  fingerspell: 'Datilologia na câmera',
  mirror_practice: 'Prática no espelho',
};

export const MISSING_LABELS: Record<string, string> = {
  validated: 'validação',
  video: 'vídeo',
  avatar: 'avatar',
  source: 'fonte',
};
