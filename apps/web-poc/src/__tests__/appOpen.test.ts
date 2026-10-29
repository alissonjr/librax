import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  APP_REOPEN_HOURS, brokenStreakOnOpen, evaluateAppOpen, leagueResultOnOpen, onAppReopen, STREAK_BROKEN_MIN,
} from '../lib/appOpen';
import { getToday } from '../lib/today';

const HOUR = 60 * 60 * 1000;

/** Repositório mínimo do perfil, em memória. */
function fakeRepo(profile: Record<string, unknown> | null) {
  return { getProfile: async () => profile };
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
  it('sequência quebrada; antes do onboarding não mostra nada (a liga vem do servidor depois)', async () => {
    const repo = fakeRepo({ streak: 7, lastActiveDay: daysAgo(4) });
    expect(await evaluateAppOpen(repo, 'u')).toEqual({ brokenStreak: 7 });

    localStorage.setItem('librax_streakBrokenShownDate', getToday());
    expect((await evaluateAppOpen(repo, 'u')).brokenStreak).toBe(0);

    localStorage.clear();
    expect(await evaluateAppOpen(repo, 'u')).toEqual({ brokenStreak: 0 });
  });

  it('resultado da liga na abertura: sem boas-vindas ou sem conta, nada', async () => {
    localStorage.clear();
    expect(await leagueResultOnOpen()).toBeNull();
    localStorage.setItem('librax_displayName', 'Ana');
    // Sem sessão (testes sem Cognito): convidado, sem liga
    expect(await leagueResultOnOpen()).toBeNull();
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
