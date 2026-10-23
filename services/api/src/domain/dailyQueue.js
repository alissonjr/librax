/**
 * Monta a fila de pratica do dia (SPEC 03 secao 6 / SPEC 02 secao 6).
 * Puro: prioriza SRS devidos (menor ef, depois maior atraso) e completa com
 * conteudo novo ate o tamanho da licao.
 *
 * @param {Array<{signId: string, ef: number, dueAt: string}>} srsItems
 * @param {string[]} newSigns  sinais ainda nao aprendidos, em ordem do curriculo
 * @param {{size?: number, today: string}} opts
 * @returns {Array<{signId: string, kind: 'review'|'new'}>}
 */
export function buildDailyQueue(srsItems, newSigns, opts) {
  const size = opts.size ?? 10;
  const today = opts.today;

  const due = srsItems
    .filter((it) => it.dueAt <= today)
    .sort((a, b) => a.ef - b.ef || (a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0));

  const review = due.slice(0, size).map((it) => ({ signId: it.signId, kind: 'review' }));
  const remaining = size - review.length;
  const fresh = newSigns.slice(0, remaining).map((signId) => ({ signId, kind: 'new' }));

  return [...review, ...fresh];
}
