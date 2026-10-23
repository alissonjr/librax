import { daysBetween } from '@apilib/dates.js';
import { isOnboarded } from './auth';
import { Flags } from './flags';
import { getToday } from './today';
import { leagueResultSeen, syncLeague, type LeagueRepo, type LeagueResult } from './leagueLocal';

/**
 * AppOpenFlow (spec-02 12.10): o que aparece ao abrir o app ou ao voltar a ele depois de horas,
 * um de cada vez e nesta ordem:
 *   1. LeagueResultSheet, se a semana da liga encerrou e o resultado ainda não foi visto;
 *   2. StreakBrokenSheet, se a sequência quebrou (3 dias ou mais) e o aviso não saiu hoje;
 *   3. nada: o mapa fica interativo direto.
 * "Abrir o app" no web: carregar a página ou voltar a uma aba que ficou oculta por
 * APP_REOPEN_HOURS horas ou mais (visibilitychange). Voltar antes disso não reabre o fluxo.
 */

/** Horas com a aba oculta para a volta contar como nova abertura (spec-02 12.10). */
export const APP_REOPEN_HOURS = 4;
const REOPEN_MS = APP_REOPEN_HOURS * 60 * 60 * 1000;

/** Sequência mínima para o aviso de sequência quebrada (spec-02 12.10: "apenas se >= 3 dias"). */
export const STREAK_BROKEN_MIN = 3;

export interface StreakProfile {
  streak?: number;
  lastActiveDay?: string | null;
  freezes?: number;
}

/**
 * Tamanho da sequência que quebrou, ou 0 se não há aviso a mostrar. A sequência guardada no
 * perfil só muda ao concluir lição, então a quebra é lida do último dia estudado: mais de um
 * dia sem estudo quebra, exceto quando um freeze cobre exatamente um dia perdido (domínio
 * streak.js). Já estudou hoje, sequência curta ou aviso já mostrado hoje: sem aviso.
 */
export function brokenStreakOnOpen(
  profile: StreakProfile | null,
  today: string,
  shownDate: string | null,
): number {
  const streak = profile?.streak ?? 0;
  const last = profile?.lastActiveDay ?? null;
  if (!last || streak < STREAK_BROKEN_MIN || shownDate === today) return 0;
  const gap = daysBetween(today, last);
  if (gap <= 1) return 0;
  if (gap === 2 && (profile?.freezes ?? 0) > 0) return 0;
  return streak;
}

export interface AppOpenSteps {
  leagueResult: LeagueResult | null;
  brokenStreak: number;
}

type OpenRepo = LeagueRepo & { getProfile(userId: string): Promise<unknown> };

/**
 * Avalia os passos do AppOpenFlow. Só lê e aplica a virada de semana da liga; as flags de
 * "já visto" (leagueResultSeen, streakBrokenShownDate) são gravadas quando o sheet aparece.
 */
export async function evaluateAppOpen(
  repo: OpenRepo,
  userId: string,
  nowMs: number = Date.now(),
): Promise<AppOpenSteps> {
  if (!isOnboarded()) return { leagueResult: null, brokenStreak: 0 };

  let leagueResult: LeagueResult | null = null;
  try {
    // Sem liga ainda, não inscreve: quem nunca participou não tem resultado (spec-02 12.7)
    const league = await syncLeague(repo, userId, nowMs, { enroll: false });
    const last = league?.lastResult;
    if (last && last.periodStart !== leagueResultSeen()) leagueResult = last;
  } catch {
    /* falha ao ler a liga não impede abrir o app */
  }

  const profile = (await repo.getProfile(userId)) as StreakProfile | null;
  const brokenStreak = brokenStreakOnOpen(profile, getToday(), Flags.streakBrokenShownDate());
  return { leagueResult, brokenStreak };
}

/**
 * Chama `cb` quando a aba volta a ficar visível depois de APP_REOPEN_HOURS horas oculta.
 * Devolve a função que para de ouvir.
 */
export function onAppReopen(cb: () => void, now: () => number = Date.now): () => void {
  let hiddenAt: number | null = document.visibilityState === 'hidden' ? now() : null;
  const onChange = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    if (hiddenAt !== null && now() - hiddenAt >= REOPEN_MS) cb();
    hiddenAt = null;
  };
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}
