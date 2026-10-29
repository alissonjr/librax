import {
  LEAGUE_SIZE,
  leagueIdOf,
  leagueResults,
  periodKey,
  periodStartOf,
} from '../domain/leagues.js';
import { formatIsoDate } from '../lib/dates.js';

// Entrada na liga pelo servidor (SPEC 02 secao 5.5). A pessoa entra na liga da semana na
// primeira licao que conta nela; o fechamento semanal leva para a semana seguinte quem fez XP.
// Os dois caminhos passam por `placeInLeague`, que garante uma liga por pessoa e semana e
// grupos de ate LEAGUE_SIZE.

/** Tentativas de grupo antes de desistir (cada grupo cheio avanca o cursor). */
const MAX_GROUP_STEPS = 1000;

/** Descritor da liga `tier` na semana `periodStart`, grupo `group` (1 = sem sufixo). */
export function leagueOf(tier, periodStart, group = 1) {
  return {
    leagueId: leagueIdOf(tier, periodStart, group),
    tier,
    period: periodKey(periodStart),
    periodStart: formatIsoDate(periodStart),
    ...(group > 1 ? { group } : {}),
  };
}

/**
 * Coloca a pessoa na liga `tier` da semana `periodStart`, num grupo com vaga.
 * Tenta `preferGroup` (o fechamento mantem o grupo da semana anterior) e depois o grupo aberto
 * do cursor; grupo cheio avanca o cursor com escrita condicional. Se a pessoa ja tem liga na
 * semana, devolve essa (nunca duas ligas na mesma semana).
 *
 * @param {object} repo
 * @param {{userId: string, tier: string, periodStart: number, preferGroup?: number, displayName?: string|null}} input
 * @returns {Promise<{leagueId: string, tier: string, period: string, status: 'joined'|'already'}>}
 */
export async function placeInLeague(repo, input) {
  const { userId, tier, periodStart, preferGroup = null, displayName = null } = input;
  const period = periodKey(periodStart);
  let group = preferGroup ?? (await repo.getLeagueGroupCursor(tier, period));

  for (let step = 0; step < MAX_GROUP_STEPS; step++) {
    const league = leagueOf(tier, periodStart, group);
    const r = await repo.joinLeague(league, userId, { maxMembers: LEAGUE_SIZE, displayName });
    if (r.status !== 'full') {
      const seat = r.status === 'already' ? await repo.getLeaguePlacement(userId, period) : null;
      return { leagueId: r.leagueId, tier: seat?.tier ?? tier, period, status: r.status };
    }
    group = await repo.advanceLeagueGroup(tier, period, group);
  }
  throw new Error(`LEAGUE_GROUPS_EXHAUSTED: ${tier} ${period}`);
}

/**
 * Resultado de cada membro da liga `league` (META) com o dominio: o mesmo calculo do
 * fechamento semanal, com leagueId, period e periodStart da liga. `members`: os membros ja
 * lidos (o fechamento tambem usa os nomes deles), para nao ler duas vezes.
 */
export async function leagueResultsOf(repo, league, members = null) {
  members ??= await repo.listLeagueMembers(league.leagueId);
  return leagueResults(
    members.map((m) => ({ userId: m.userId, xpPeriod: m.xpPeriod ?? 0 })),
    league.tier,
  ).map((r) => ({ ...r, leagueId: league.leagueId, period: league.period, periodStart: league.periodStart }));
}

/**
 * Resultado da ultima liga da pessoa quando ela ja acabou mas o fechamento semanal ainda nao
 * gravou nada para ela (o job roda segunda 00:05 UTC; no Brasil e domingo 21:05). Sem
 * gravar nada: o mesmo calculo que o job vai fazer.
 * @returns {Promise<{result: object|null, league: object|null}>}
 */
export async function unsettledResult(repo, userId, period, state) {
  const last = await repo.getUserLeague(userId);
  if (!last?.period || last.period >= period) return { result: null, league: null };
  if ((state?.lastClosedPeriod ?? '') >= last.period) return { result: null, league: null };

  const league = await repo.getLeague(last.leagueId);
  if (!league) return { result: null, league: null };
  const result = (await leagueResultsOf(repo, league)).find((r) => r.userId === userId) ?? null;
  return { result, league };
}

/**
 * Liga da pessoa na semana de `nowMs`, colocando-a se for a primeira licao da semana:
 * - ja tem vaga na semana (inclusive levada pelo fechamento): fica onde esta;
 * - tem resultado de semana anterior: entra na liga de destino (`toTier`);
 * - a ultima liga acabou e o fechamento ainda nao rodou: grava o resultado dela (escrita
 *   condicional por semana, o job depois so confirma) e entra no destino;
 * - nunca teve liga: Bronze.
 *
 * @param {object} repo
 * @param {{userId: string, nowMs: number, displayName?: string|null}} input
 * @returns {Promise<{leagueId: string, tier: string, period: string}>}
 */
export async function ensureLeague(repo, input) {
  const { userId, nowMs, displayName = null } = input;
  const periodStart = periodStartOf(nowMs);
  const period = periodKey(periodStart);

  const seat = await repo.getLeaguePlacement(userId, period);
  if (seat) return seat;

  const state = await repo.getLeagueState(userId);
  let tier = state?.tier ?? 'bronze';
  let preferGroup = null;

  const pending = await unsettledResult(repo, userId, period, state);
  if (pending.result) {
    const { result: effective } = await repo.applyLeagueResult(userId, pending.result);
    tier = effective.toTier;
    preferGroup = pending.league.group ?? 1;
  }

  const placed = await placeInLeague(repo, { userId, tier, periodStart, preferGroup, displayName });
  return { leagueId: placed.leagueId, tier: placed.tier, period };
}
