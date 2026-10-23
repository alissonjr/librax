// Ligas semanais (SPEC 02 secao 5.5 / frontend 12.7).
// Ranking por xpPeriod desc; top N promove, bottom M rebaixa.
// O app roda estas mesmas funcoes no modo local (apps/web-poc/src/lib/leagueLocal.ts); as
// ligas, as zonas por liga e o formato do leagueId abaixo seguem o que o app ja usa.

export const PROMOTE = 3;
export const RELEGATE = 10;
const DEFAULTS = { promote: PROMOTE, relegate: RELEGATE };

/** Ligas em ordem crescente (mesma lista do app). */
export const TIERS = ['bronze', 'prata', 'ouro', 'safira', 'rubi', 'ametista', 'diamante'];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function tierIndex(tier) {
  const i = TIERS.indexOf(tier);
  if (i < 0) throw new Error(`liga desconhecida: ${tier}`);
  return i;
}

export function tierAbove(tier) {
  return TIERS[tierIndex(tier) + 1] ?? null;
}

export function tierBelow(tier) {
  const i = tierIndex(tier);
  return i > 0 ? TIERS[i - 1] : null;
}

/** Zonas da liga: Bronze nao rebaixa (e a primeira) e Diamante nao promove (e a ultima). */
export function zoneOptsForTier(tier) {
  return {
    promote: tierAbove(tier) ? PROMOTE : 0,
    relegate: tierBelow(tier) ? RELEGATE : 0,
  };
}

/** Inicio da semana da liga: segunda-feira 00:00 UTC (epoch ms). */
export function periodStartOf(nowMs) {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS;
}

export function nextPeriodStart(periodStart) {
  return periodStart + WEEK_MS;
}

/** Semana ISO 8601 da segunda `periodStart` como 'AAAA-wSS' (a quinta decide o ano). */
export function periodKey(periodStart) {
  const thursday = new Date(periodStart + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return `${year}-w${String(week).padStart(2, '0')}`;
}

/**
 * Id da liga: 'bronze-2026-w43' (formato do app). Com mais de ~30 pessoas na mesma liga e
 * semana, o servidor separa em grupos: 'bronze-2026-w43-g2'.
 */
export function leagueIdOf(tier, periodStart, group) {
  return `${tier}-${periodKey(periodStart)}${group ? `-g${group}` : ''}`;
}

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

/**
 * Resultado de cada membro ao fechar a semana, com as zonas da liga `tier` (o mesmo calculo
 * do fechamento local do app: rankLeague + closeLeague com zoneOpts).
 * @returns {Array<{userId: string, xp: number, rank: number, total: number,
 *   outcome: 'promoted'|'stayed'|'relegated', fromTier: string, toTier: string}>}
 */
export function leagueResults(members, tier) {
  const opts = zoneOptsForTier(tier);
  const { promoted, relegated } = closeLeague(members, opts);
  const up = new Set(promoted);
  const down = new Set(relegated);
  const total = members.length;
  return rankLeague(members, opts).map((m) => {
    const outcome = up.has(m.userId) ? 'promoted' : down.has(m.userId) ? 'relegated' : 'stayed';
    const toTier = outcome === 'promoted' ? tierAbove(tier) : outcome === 'relegated' ? tierBelow(tier) : tier;
    return { userId: m.userId, xp: m.xpPeriod, rank: m.rank, total, outcome, fromTier: tier, toTier };
  });
}
