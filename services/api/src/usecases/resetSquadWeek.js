import { periodKey, periodStartOf } from '../domain/leagues.js';
import { rankSquadWeek, weekXpOf } from '../domain/squads.js';
import { formatIsoDate } from '../lib/dates.js';

/**
 * Reset semanal das squads (SPEC 04 secoes 0.3 e 8), no mesmo job que fecha as ligas.
 *
 * Percorre, pagina a pagina, as squads que tiveram XP na semana `periodStart` (GSI2
 * `SQUADS#<semana>`, marcadas pela primeira licao da semana) e, para cada uma ainda aberta:
 * 1. vira a semana no META e nos membros que ainda estao nela (xpWeekly e xpWeeklyContrib a
 *    zero, valor da semana em lastWeekXp); quem ja estudou na semana nova virou sozinho e nao
 *    perde esse XP;
 * 2. guarda a semana em `SQUAD#<id> / WEEK#<semana>`: total da squad, total de membros e o
 *    ranking interno (xpWeeklyContrib desc), fechada uma vez so.
 *
 * O total historico (xpAllTime, xpAllTimeContrib) e somado na propria licao. Rodar de novo
 * pula as semanas ja fechadas; uma queda no meio pode ser refeita com o mesmo `periodStart`.
 *
 * @param {object} repo
 * @param {{periodStart: number, pageSize?: number, closedAt?: string}} input
 */
export async function resetSquadWeek(repo, input) {
  const { periodStart, pageSize = 25, closedAt = new Date().toISOString() } = input;
  if (!Number.isFinite(periodStart) || periodStartOf(periodStart) !== periodStart) {
    throw new Error('INVALID_PERIOD');
  }
  const period = periodKey(periodStart);
  const report = { period, pages: 0, squads: 0, skipped: 0, members: 0, xp: 0 };

  let cursor = null;
  do {
    const page = await repo.listSquadWeeks(period, { limit: pageSize, cursor });
    report.pages += 1;

    for (const week of page.weeks) {
      if (week.status === 'closed') {
        report.skipped += 1;
        continue;
      }
      await repo.rollSquadWeek(week.squadId, period);

      const squad = await repo.getSquad(week.squadId);
      if (!squad) {
        report.skipped += 1; // dissolvida no meio
        continue;
      }
      const members = await repo.listMembers(week.squadId);
      const ranking = rankSquadWeek(
        members.map((m) => ({ userId: m.userId, xp: weekXpOf(m, 'xpWeeklyContrib', period) })),
      );
      const xpWeekly = weekXpOf(squad, 'xpWeekly', period);

      await repo.saveSquadWeek(week.squadId, period, {
        periodStart: formatIsoDate(periodStart),
        xpWeekly,
        memberCount: squad.memberCount ?? members.length,
        ranking,
        closedAt,
      });
      report.squads += 1;
      report.members += members.length;
      report.xp += xpWeekly;
    }

    cursor = page.cursor ?? null;
  } while (cursor);

  return report;
}
