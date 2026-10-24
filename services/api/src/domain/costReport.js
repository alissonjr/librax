import { addDays, daysBetween, formatIsoDate } from '../lib/dates.js';

// Custo do mes para o painel de administracao (docs/painel-admin.md).
//
// O Cost Explorer cobra US$ 0,01 por chamada, entao o job diario consulta uma vez so e guarda o
// resultado em OPS / COST#<AAAA-MM>; a tela le o item. As datas do Cost Explorer sao em UTC e o
// fim e exclusivo. Os dados de ontem ainda podem mudar (o Cost Explorer atualiza ate 24 h depois),
// por isso a estimativa do mes e uma projecao linear do que ja foi gasto, nao a previsao paga
// (GetCostForecast, mais US$ 0,01 por chamada).

/**
 * Periodo a consultar hoje. No dia 1 o mes novo ainda nao tem dia fechado: consulta o mes que
 * acabou, inteiro, e o guarda como fechado.
 * @param {Date} now
 * @returns {{month: string, start: string, end: string, complete: boolean, daysElapsed: number, daysInMonth: number}}
 */
export function costWindow(now) {
  const today = formatIsoDate(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const firstOfMonth = `${today.slice(0, 8)}01`;
  const complete = today === firstOfMonth;
  const start = complete ? `${addDays(firstOfMonth, -1).slice(0, 8)}01` : firstOfMonth;
  const end = today;
  const [y, m] = start.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month: start.slice(0, 7), start, end, complete, daysElapsed: daysBetween(end, start), daysInMonth };
}

const cents = (n) => Math.round(n * 100) / 100;

/**
 * Item guardado em COST#<mes>.
 * @param {object} window  costWindow(now)
 * @param {Array<{service: string, amount: number}>} services  gasto por servico no periodo
 * @param {object} [opts]  { currency = 'USD', asOf = ISO }
 */
export function buildCostReport(window, services, { currency = 'USD', asOf = null } = {}) {
  const byService = services
    .map(({ service, amount }) => ({ service, amount: cents(amount) }))
    .filter((s) => s.amount !== 0)
    .sort((a, b) => b.amount - a.amount || (a.service < b.service ? -1 : 1));
  const total = cents(services.reduce((acc, s) => acc + s.amount, 0));
  const projectedTotal = window.complete || window.daysElapsed <= 0
    ? total
    : cents((total / window.daysElapsed) * window.daysInMonth);
  return {
    month: window.month,
    start: window.start,
    end: window.end,
    complete: window.complete,
    daysElapsed: window.daysElapsed,
    daysInMonth: window.daysInMonth,
    currency,
    total,
    projectedTotal,
    byService,
    asOf,
  };
}
