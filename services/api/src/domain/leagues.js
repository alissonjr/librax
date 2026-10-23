// Ligas semanais (SPEC 02 secao 5.5 / frontend 12.7).
// Ranking por xpPeriod desc; top N promove, bottom M rebaixa.

const DEFAULTS = { promote: 3, relegate: 10 };

/**
 * Ordena os membros e atribui rank (1-based) e zona.
 * Desempate estavel por userId asc.
 *
 * @param {Array<{userId: string, xpPeriod: number}>} members
 * @param {{promote?: number, relegate?: number}} [opts]
 * @returns {Array<{userId: string, xpPeriod: number, rank: number, zone: 'promotion'|'relegation'|'stay'}>}
 */
export function rankLeague(members, opts = {}) {
  const promote = opts.promote ?? DEFAULTS.promote;
  const relegate = opts.relegate ?? DEFAULTS.relegate;

  const sorted = [...members].sort(
    (a, b) => b.xpPeriod - a.xpPeriod || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
  );

  const n = sorted.length;
  const promoCount = Math.min(promote, n);
  // rebaixamento nunca invade a faixa de promocao
  const relegCount = Math.min(relegate, n - promoCount);
  const relegStart = n - relegCount; // indice (0-based) onde comeca a zona de rebaixamento

  return sorted.map((m, i) => ({
    ...m,
    rank: i + 1,
    zone: i < promoCount ? 'promotion' : i >= relegStart ? 'relegation' : 'stay',
  }));
}

/**
 * Classifica os membros ao fechar a liga.
 * @returns {{promoted: string[], relegated: string[], stayed: string[]}}
 */
export function closeLeague(members, opts = {}) {
  const ranked = rankLeague(members, opts);
  const promoted = [];
  const relegated = [];
  const stayed = [];
  for (const m of ranked) {
    if (m.zone === 'promotion') promoted.push(m.userId);
    else if (m.zone === 'relegation') relegated.push(m.userId);
    else stayed.push(m.userId);
  }
  return { promoted, relegated, stayed };
}
