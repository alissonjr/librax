// Aritmetica de datas-calendario em 'YYYY-MM-DD' (sem hora, sem fuso).
// Usa UTC internamente so para nao sofrer drift de horario de verao; a
// conversao para o fuso do usuario e responsabilidade de quem chama.

/** @param {string} iso 'YYYY-MM-DD' */
export function parseIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`data invalida: ${iso}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** @param {number} ts epoch ms (UTC, meia-noite) */
export function formatIsoDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Soma `n` dias (pode ser negativo) a uma data ISO e devolve ISO. */
export function addDays(iso, n) {
  return formatIsoDate(parseIsoDate(iso) + n * DAY_MS);
}

/** Diferenca em dias inteiros: dias(a, b) = a - b. */
export function daysBetween(a, b) {
  return Math.round((parseIsoDate(a) - parseIsoDate(b)) / DAY_MS);
}
