import { buildLeagueView, isPeriodKey, periodKey, periodStartOf } from '../domain/leagues.js';
import { unsettledResult } from './leagueEnrollment.js';

/**
 * GET /v1/league/current: liga da semana, ranking, tempo ate o fechamento e o ultimo
 * resultado ainda nao visto (SPEC 02 secoes 5.5 e 12.7). So leitura: nao coloca ninguem numa
 * liga (isso acontece na primeira licao da semana) e nao grava resultado. Se o fechamento
 * ainda nao rodou para a ultima liga da pessoa, mostra o resultado calculado com o mesmo
 * dominio do job.
 *
 * @param {object} repo
 * @param {{userId: string, nowMs: number}} input
 */
export async function getCurrentLeague(repo, input) {
  const { userId, nowMs } = input;
  const period = periodKey(periodStartOf(nowMs));

  const [seat, state, seenPeriod] = await Promise.all([
    repo.getLeaguePlacement(userId, period),
    repo.getLeagueState(userId),
    repo.getLeagueResultSeen(userId),
  ]);

  let lastResult = state?.lastResult ?? null;
  let tier = seat?.tier ?? state?.tier ?? 'bronze';
  if (!seat) {
    const { result } = await unsettledResult(repo, userId, period, state);
    if (result) {
      lastResult = result;
      tier = result.toTier;
    }
  }

  const members = seat ? await repo.listLeagueMembers(seat.leagueId) : [];
  return buildLeagueView({
    userId,
    tier,
    leagueId: seat?.leagueId ?? null,
    members,
    nowMs,
    lastResult,
    seenPeriod,
  });
}

/**
 * POST /v1/league/result-seen: o app mostrou o LeagueResultSheet da semana `period`
 * (spec-02 12.7: marcado ao exibir). Guarda so para frente; semana atual ou futura nao tem
 * resultado e e recusada.
 *
 * @param {object} repo
 * @param {{userId: string, period: string, nowMs: number}} input
 * @returns {Promise<{period: string}>}
 */
export async function markLeagueResultSeen(repo, input) {
  const { userId, period, nowMs } = input;
  if (!isPeriodKey(period) || period >= periodKey(periodStartOf(nowMs))) {
    throw new Error('INVALID_PERIOD');
  }
  await repo.markLeagueResultSeen(userId, period);
  return { period };
}
