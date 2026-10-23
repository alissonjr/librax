import { addDays } from '../lib/dates.js';
import {
  buildOverview,
  opsKey,
  opsToday,
  OVERVIEW_DAYS,
  OVERVIEW_MONTHS,
  OVERVIEW_WEEKS,
} from '../domain/opsMetrics.js';
import { currentWeekXp } from '../domain/squads.js';
import { periodKey, periodStartOf } from '../domain/leagues.js';

// Usecases de leitura do painel de administracao (docs/painel-admin.md). So leem: nenhuma rota
// do painel muda dado nesta etapa. Toda leitura e por chave ou Query numa particao conhecida
// (OPS, USER#<id>, SQUADINDEX); nada de Scan.

/** Tela de operacao: 30 dias, 12 semanas e 12 meses, com tres Querys na particao OPS. */
export async function opsOverview(repo, { now, labels = {}, days = OVERVIEW_DAYS }) {
  const today = opsToday(now);
  const from = addDays(today, -(days - 1));
  const [dayItems, weekItems, monthItems] = await Promise.all([
    // `#~` fecha a faixa depois dos itens do proprio dia (DAY#<dia>#LESSON etc.)
    repo.listOpsRange(opsKey.day(from), `${opsKey.day(today)}#~`),
    repo.listOpsLatest('WEEK#', OVERVIEW_WEEKS),
    repo.listOpsLatest('MONTH#', OVERVIEW_MONTHS),
  ]);
  return buildOverview({ dayItems, weekItems, monthItems, today, days, labels });
}

/**
 * Resumo de uma conta (tela Contas): perfil, progresso, liga e squads. Sem acoes.
 * @returns {Promise<object|null>} null se a conta nao existe nem no Cognito nem na tabela
 */
export async function accountSummary(repo, directory, { userId, labels = {}, totalLessons = null, now }) {
  const [account, profile, progress, srs, achievements, leagueState, league, userSquads, activity] = await Promise.all([
    directory.get(userId),
    repo.getProfile(userId),
    repo.listProgress(userId),
    repo.listSrsItems(userId),
    repo.listEarnedAchievements(userId),
    repo.getLeagueState(userId),
    repo.getUserLeague(userId),
    repo.listUserSquads(userId),
    repo.getActivity(userId),
  ]);
  if (!account && !profile) return null;

  const today = opsToday(now);
  const period = periodKey(periodStartOf(now.getTime()));
  const leagueXp = league ? await repo.getLeagueMemberXp(league.leagueId, userId) : null;
  const squads = await Promise.all(
    userSquads.map(async ({ squadId }) => {
      const [squad, member] = await Promise.all([repo.getSquad(squadId), repo.getMember(squadId, userId)]);
      return {
        squadId,
        name: squad?.name ?? null,
        type: squad?.type ?? null,
        memberCount: squad?.memberCount ?? null,
        role: member?.role ?? null,
        xpWeeklyContrib: member ? currentWeekXp(member.xpWeeklyContrib, member.xpWeekPeriod, period) : 0,
      };
    }),
  );

  const lessons = progress
    .map((p) => ({
      lessonId: p.lessonId,
      title: labels.lessons?.[p.lessonId]?.title ?? null,
      unitId: labels.lessons?.[p.lessonId]?.unitId ?? null,
      status: p.status ?? null,
      bestScore: p.bestScore ?? null,
      completedAt: p.completedAt ?? null,
    }))
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.lessonId.localeCompare(b.lessonId));

  return {
    userId,
    account,
    profile: profile
      ? {
          displayName: profile.displayName ?? null,
          timezone: profile.timezone ?? null,
          xpTotal: profile.xpTotal ?? 0,
          streak: profile.streak ?? 0,
          lastActiveDay: profile.lastActiveDay ?? null,
          freezes: profile.freezes ?? 0,
          dailyGoalXp: profile.dailyGoalXp ?? null,
          signsLearned: profile.signsLearned ?? 0,
          lessonsCompleted: profile.lessonsCompleted ?? 0,
          alphabetComplete: Boolean(profile.alphabetComplete),
        }
      : null,
    progress: {
      distinctLessons: lessons.filter((l) => l.status === 'completed').length,
      totalLessons,
      lessons,
    },
    srs: { signs: srs.length, due: srs.filter((i) => i.dueAt && i.dueAt <= today).length },
    achievements: [...achievements].sort(),
    league: {
      tier: leagueState?.tier ?? null,
      current: league ? { leagueId: league.leagueId, period: league.period ?? null, xpPeriod: leagueXp } : null,
      lastResult: leagueState?.lastResult ?? null,
    },
    squads,
    activity: activity
      ? { lastDay: activity.lastDay ?? null, lastWeek: activity.lastWeek ?? null, lastMonth: activity.lastMonth ?? null }
      : null,
  };
}

/** Lista de squads (moderacao futura): nome, tipo, tamanho e criacao, da mais nova para a mais velha. */
export async function listSquads(repo, { limit = 25, cursor = null, now }) {
  const page = await repo.listSquadIndex({ limit, cursor });
  const period = periodKey(periodStartOf(now.getTime()));
  const squads = (await Promise.all(page.squads.map((s) => repo.getSquad(s.squadId))))
    .filter(Boolean) // dissolvida entre o registro e a leitura
    .map((s) => ({
      squadId: s.squadId,
      name: s.name ?? null,
      type: s.type ?? null,
      memberCount: s.memberCount ?? 0,
      maxMembers: s.maxMembers ?? null,
      createdAt: s.createdAt ?? null,
      createdBy: s.createdBy ?? null,
      xpWeekly: currentWeekXp(s.xpWeekly, s.xpWeekPeriod, period),
      xpAllTime: s.xpAllTime ?? 0,
    }));
  return { squads, cursor: page.cursor };
}

/** Custo: o mes mais recente guardado pelo job diario e o historico (ate 6 meses). */
export async function costView(repo) {
  const items = await repo.listOpsLatest('COST#', 6);
  const months = items.map(({ key, byService, ...rest }) => rest);
  return { latest: items[0] ? (({ key, ...rest }) => rest)(items[0]) : null, months };
}
