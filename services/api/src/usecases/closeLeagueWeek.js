import { nextPeriodStart, periodKey, periodStartOf } from '../domain/leagues.js';
import { formatIsoDate } from '../lib/dates.js';
import { leagueResultsOf, placeInLeague } from './leagueEnrollment.js';

/**
 * Fechamento semanal das ligas (SPEC 02 secao 5.5), chamado pela Lambda do Scheduler.
 *
 * Percorre, pagina a pagina, todas as ligas da semana `periodStart` (GSI2 `LEAGUES#<semana>`)
 * e, para cada liga ainda aberta:
 * 1. calcula o resultado de cada membro com o dominio (rankLeague + closeLeague, zonas da liga);
 * 2. grava o resultado no estado do usuario (`USER#<id> / LEAGUE`) com escrita condicional por
 *    semana: se ja foi gravado, vale o que esta gravado (rodar de novo nao promove de novo);
 * 3. quem fez XP na semana entra na liga da semana seguinte (`toTier`, de preferencia no mesmo
 *    grupo, sempre com no maximo 30 por grupo), sem zerar XP que ja tenha entrado nela; quem ja
 *    entrou sozinho na semana nova (licao antes do job) fica onde esta; quem ficou sem XP fica
 *    so com o estado (como no app, semana sem estudo nao gera rebaixamento extra);
 * 4. marca a liga como fechada. Liga fechada e pulada numa nova execucao.
 *
 * Qualquer queda no meio pode ser refeita com o mesmo `periodStart`.
 *
 * @param {object} repo  porta (InMemoryRepo / DynamoRepo)
 * @param {{periodStart: number, pageSize?: number, closedAt?: string}} input
 *   periodStart: segunda 00:00 UTC (epoch ms) da semana que terminou
 */
export async function closeLeagueWeek(repo, input) {
  const { periodStart, pageSize = 25, closedAt = new Date().toISOString() } = input;
  if (!Number.isFinite(periodStart) || periodStartOf(periodStart) !== periodStart) {
    throw new Error('INVALID_PERIOD');
  }
  const period = periodKey(periodStart);
  const next = nextPeriodStart(periodStart);

  const report = {
    period,
    pages: 0,
    closed: 0,
    skipped: 0,
    members: 0,
    promoted: 0,
    relegated: 0,
    stayed: 0,
    carried: 0,
    alreadyApplied: 0,
  };

  let cursor = null;
  do {
    const page = await repo.listLeaguesOfPeriod(period, { limit: pageSize, cursor });
    report.pages += 1;

    for (const league of page.leagues) {
      if (league.status === 'closed') {
        report.skipped += 1;
        continue;
      }

      const members = await repo.listLeagueMembers(league.leagueId);
      const results = await leagueResultsOf(repo, {
        ...league,
        period: league.period ?? period,
        periodStart: league.periodStart ?? formatIsoDate(periodStart),
      }, members);
      // quem segue para a semana nova leva o nome da liga que fechou (ranking com nome)
      const names = new Map(members.map((m) => [m.userId, m.displayName ?? null]));
      const counts = { promoted: 0, relegated: 0, stayed: 0 };

      for (const result of results) {
        const { applied, result: effective } = await repo.applyLeagueResult(result.userId, result);
        if (!applied) report.alreadyApplied += 1;
        counts[effective.outcome] += 1;
        // segue o resultado gravado (nao o recalculado) para nunca divergir do estado
        if (effective.period === period && effective.xp > 0) {
          await placeInLeague(repo, {
            userId: result.userId,
            tier: effective.toTier,
            periodStart: next,
            preferGroup: league.group ?? 1,
            displayName: names.get(result.userId) ?? null,
          });
          report.carried += 1;
        }
      }

      await repo.markLeagueClosed(league.leagueId, { closedAt, total: results.length, ...counts });
      report.closed += 1;
      report.members += results.length;
      report.promoted += counts.promoted;
      report.relegated += counts.relegated;
      report.stayed += counts.stayed;
    }

    cursor = page.cursor ?? null;
  } while (cursor);

  return report;
}
