import { addDays } from '../lib/dates.js';

/**
 * @typedef {Object} SrsItem
 * @property {number} ef        easiness factor (inicia 2.5, piso 1.3)
 * @property {number} reps      repeticoes corretas consecutivas
 * @property {number} interval  intervalo atual em dias
 * @property {string|null} [dueAt] proxima revisao ('YYYY-MM-DD')
 */

/** Item de memoria zerado para um par (usuario, sinal). @returns {SrsItem} */
export function newSrsItem() {
  return { ef: 2.5, reps: 0, interval: 0, dueAt: null };
}

/**
 * Atualiza o item apos uma revisao (SM-2 adaptado, SPEC 03 secao 6).
 * Puro: devolve um item novo, nao muta a entrada.
 *
 * @param {SrsItem} item
 * @param {number} q  qualidade da resposta 0..5 (ver qualityFromResult)
 * @param {string} today 'YYYY-MM-DD' (fuso do usuario)
 * @returns {SrsItem}
 */
export function updateSrs(item, q, today) {
  let ef = item.ef ?? 2.5;
  let reps = item.reps ?? 0;
  let interval = item.interval ?? 0;

  if (q < 3) {
    // errou: recomeca o ciclo, revisa amanha (ef preservado)
    reps = 0;
    interval = 1;
  } else {
    ef = Math.max(1.3, ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ef);
  }

  return { ef, reps, interval, dueAt: addDays(today, interval) };
}

/**
 * Deriva a qualidade q (0..5) do resultado da avaliacao do sinal (SPEC 03 secao 6).
 * `no_capture` nao e erro do aluno: retorna null para sinalizar "nao atualizar SRS".
 *
 * @param {{state: string, highConfidence?: boolean}} result
 * @returns {number|null}
 */
export function qualityFromResult(result) {
  switch (result.state) {
    case 'correct':
      return result.highConfidence ? 5 : 4;
    case 'accept_soft':
      return 3;
    case 'retry_resolved':
      return 2;
    case 'failed':
      return 1;
    case 'no_capture':
      return null;
    default:
      throw new Error(`estado de avaliacao desconhecido: ${result.state}`);
  }
}
