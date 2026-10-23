// Ligas semanais (SPEC 02 secao 5.5 / frontend 12.7).
// Ranking por xpPeriod desc; top N promove, bottom M rebaixa.
// O app roda estas mesmas funcoes no modo local (apps/web-poc/src/lib/leagueLocal.ts); as
// ligas, as zonas por liga e o formato do leagueId abaixo seguem o que o app ja usa.

import { parseIsoDate } from '../lib/dates.js';

export const PROMOTE = 3;
export const RELEGATE = 10;
/** Tamanho maximo de um grupo de liga (mesma semana e liga); acima disso abre `-g<n>`. */
export const LEAGUE_SIZE = 30;
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
 * Id da liga: 'bronze-2026-w43' (formato do app). Com mais de 30 pessoas na mesma liga e
 * semana, o servidor separa em grupos: o 1o fica sem sufixo e os outros 'bronze-2026-w43-g2'.
 */
export function leagueIdOf(tier, periodStart, group) {
  return `${tier}-${periodKey(periodStart)}${group > 1 ? `-g${group}` : ''}`;
}

/**
 * A licao do dia `today` (data do aparelho, 'AAAA-MM-DD') conta na liga da semana
 * `periodStart`? Aceita o domingo anterior porque a semana vira na segunda 00:00 UTC, que no
 * Brasil ainda e domingo a noite. Licao de outra semana (migracao do convidado, fila offline
 * antiga) soma no perfil, mas nao na liga nem no XP semanal das squads.
 */
export function countsForWeek(today, periodStart) {
  const day = parseIsoDate(today);
  return day >= periodStart - DAY_MS && day < periodStart + WEEK_MS + DAY_MS;
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

const PERIOD_RE = /^\d{4}-w\d{2}$/;

/** 'AAAA-wSS' valido (formato de periodKey). */
export function isPeriodKey(value) {
  return typeof value === 'string' && PERIOD_RE.test(value);
}

/**
 * Visao da liga para a LeagueScreen, no formato do `LeagueView` do app
 * (apps/web-poc/src/lib/leagueLocal.ts), com `mode: 'server'` e sem membros simulados.
 * Sem liga na semana (`leagueId` null): `enrolled: false`, ranking vazio e `you: null`, com a
 * liga em que a pessoa vai entrar na proxima licao (`tier`).
 * `pendingResult` e o ultimo resultado ainda nao visto (`seenPeriod` menor que a semana dele).
 *
 * @param {{userId: string, tier: string, leagueId: string|null, members: Array<{userId: string,
 *   xpPeriod: number, displayName?: string}>, nowMs: number, lastResult?: object|null,
 *   seenPeriod?: string|null}} input
 */
export function buildLeagueView(input) {
  const { userId, tier, leagueId, members = [], nowMs, lastResult = null, seenPeriod = null } = input;
  const periodStart = periodStartOf(nowMs);
  const periodEnd = nextPeriodStart(periodStart);
  const period = periodKey(periodStart);
  const opts = zoneOptsForTier(tier);
  const names = new Map(members.map((m) => [m.userId, m.displayName ?? null]));

  const rows = leagueId
    ? rankLeague(members.map((m) => ({ userId: m.userId, xpPeriod: m.xpPeriod ?? 0 })), opts).map((m) => ({
        userId: m.userId,
        name: names.get(m.userId) ?? null,
        xpPeriod: m.xpPeriod,
        rank: m.rank,
        zone: m.zone,
        isYou: m.userId === userId,
        simulated: false,
      }))
    : [];

  const pending = lastResult && lastResult.period > (seenPeriod ?? '') ? lastResult : null;

  return {
    mode: 'server',
    enrolled: leagueId != null,
    tier,
    leagueId,
    week: Number(period.slice(-2)),
    period,
    periodStart,
    periodEnd,
    msUntilClose: Math.max(0, periodEnd - nowMs),
    promote: opts.promote,
    relegate: opts.relegate,
    rows,
    you: rows.find((r) => r.isYou) ?? null,
    pendingResult: pending
      ? {
          period: pending.period,
          periodStart: parseIsoDate(pending.periodStart),
          leagueId: pending.leagueId,
          fromTier: pending.fromTier,
          toTier: pending.toTier,
          outcome: pending.outcome,
          rank: pending.rank,
          total: pending.total,
          xp: pending.xp,
        }
      : null,
  };
}
