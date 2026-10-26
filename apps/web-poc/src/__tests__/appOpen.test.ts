import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  APP_REOPEN_HOURS, brokenStreakOnOpen, evaluateAppOpen, onAppReopen, STREAK_BROKEN_MIN,
} from '../lib/appOpen';
import { markLeagueResultSeen, periodStartOf, type LeagueState } from '../lib/leagueLocal';
import { getToday } from '../lib/today';

const HOUR = 60 * 60 * 1000;
const WEEK = 7 * 24 * HOUR;

/** Repositório mínimo das ligas e do perfil, em memória. */
function fakeRepo(state: LeagueState | null, profile: Record<string, unknown> | null) {
  let league = state;
  const xp = new Map<string, number>();
  return {
    getLeagueState: async () => league,
    saveLeagueState: async (s: LeagueState) => { league = s; },
    getLeagueMemberXp: async (leagueId: string, userId: string) => xp.get(`${leagueId}/${userId}`) ?? 0,
    setLeagueMemberXp: async (leagueId: string, userId: string, v: number) => { xp.set(`${leagueId}/${userId}`, v); },
    getDayXp: async () => 0,
    getProfile: async () => profile,
    current: () => league,
  };
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
});

describe('sequência quebrada na abertura (spec-02 12.10, passo 2)', () => {
  const today = '2026-10-23';

  it('quebra com mais de um dia sem estudo e sequência de 3 dias ou mais', () => {
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: '2026-10-20' }, today, null)).toBe(5);
    expect(brokenStreakOnOpen({ streak: STREAK_BROKEN_MIN, lastActiveDay: '2026-10-21' }, today, null)).toBe(3);
  });

  it('sem aviso: estudou hoje ou ontem, sequência curta ou aviso já mostrado hoje', () => {
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: today }, today, null)).toBe(0);
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: '2026-10-22' }, today, null)).toBe(0);
    expect(brokenStreakOnOpen({ streak: 2, lastActiveDay: '2026-10-10' }, today, null)).toBe(0);
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: '2026-10-10' }, today, today)).toBe(0);
    expect(brokenStreakOnOpen(null, today, null)).toBe(0);
  });

  it('um freeze cobre exatamente um dia perdido (domínio streak.js)', () => {
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: '2026-10-21', freezes: 1 }, today, null)).toBe(0);
    expect(brokenStreakOnOpen({ streak: 5, lastActiveDay: '2026-10-20', freezes: 1 }, today, null)).toBe(5);
  });
});

describe('evaluateAppOpen', () => {
  const now = Date.now();
  const lastWeek = periodStartOf(now) - WEEK;

  it('semana encerrada: fecha a liga e devolve o resultado ainda não visto', async () => {
    const repo = fakeRepo({ userId: 'u', tier: 'bronze', periodStart: lastWeek }, null);
    const steps = await evaluateAppOpen(repo, 'u', now);
    expect(steps.leagueResult?.periodStart).toBe(lastWeek);
    expect(steps.leagueResult?.fromTier).toBe('bronze');
    // A avaliação não marca como visto: isso acontece quando o sheet aparece
    const again = await evaluateAppOpen(repo, 'u', now);
    expect(again.leagueResult?.periodStart).toBe(lastWeek);
  });

  it('resultado já visto ou pessoa sem liga: nada da liga (e não inscreve ninguém)', async () => {
    const seen = fakeRepo({ userId: 'u', tier: 'bronze', periodStart: lastWeek }, null);
    await evaluateAppOpen(seen, 'u', now);
    markLeagueResultSeen(lastWeek);
    expect((await evaluateAppOpen(seen, 'u', now)).leagueResult).toBeNull();

    const none = fakeRepo(null, null);
    expect((await evaluateAppOpen(none, 'u', now)).leagueResult).toBeNull();
    expect(none.current()).toBeNull();
  });

  it('junta liga e sequência; antes do onboarding não mostra nada', async () => {
    const repo = fakeRepo(
      { userId: 'u', tier: 'prata', periodStart: lastWeek },
      { streak: 7, lastActiveDay: daysAgo(4) },
    );
    const steps = await evaluateAppOpen(repo, 'u', now);
    expect(steps.leagueResult).not.toBeNull();
    expect(steps.brokenStreak).toBe(7);

    localStorage.setItem('librax_streakBrokenShownDate', getToday());
    expect((await evaluateAppOpen(repo, 'u', now)).brokenStreak).toBe(0);

    localStorage.clear();
    expect(await evaluateAppOpen(repo, 'u', now)).toEqual({ leagueResult: null, brokenStreak: 0 });
  });
});

describe('voltar ao app (visibilitychange)', () => {
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  it(`conta como nova abertura só depois de ${APP_REOPEN_HOURS} h com a aba oculta`, () => {
    let clock = 0;
    const cb = vi.fn();
    setVisibility('visible');
    const stop = onAppReopen(cb, () => clock);

    setVisibility('hidden');
    clock += APP_REOPEN_HOURS * HOUR - 1;
    setVisibility('visible');
    expect(cb).not.toHaveBeenCalled();

    setVisibility('hidden');
    clock += APP_REOPEN_HOURS * HOUR;
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);

    stop();
    setVisibility('hidden');
    clock += 10 * HOUR;
    setVisibility('visible');
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
