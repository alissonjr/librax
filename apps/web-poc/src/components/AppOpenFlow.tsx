import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useAppNavigation } from '../hooks/useAppNavigation';
import { ROUTES } from '../lib/routes';
import { Flags } from '../lib/flags';
import { getToday } from '../lib/today';
import { markLeagueResultSeen } from '../lib/leagueLocal';
import { LeagueResultSheet } from './LeagueResultSheet';
import { StreakBrokenSheet } from './StreakBrokenSheet';
import { InstallSheet, useInstallMode } from './InstallSheet';

/**
 * Sheets da abertura do app nas telas com abas, um de cada vez (spec-02 12.10):
 *   1. resultado da liga não visto (LeagueResultSheet);
 *   2. sequência quebrada (StreakBrokenSheet);
 *   3. depois deles, a sugestão de instalar, só no mapa (shouldSuggestInstall, decisão 13).
 * As flags de "já visto" são gravadas quando o sheet aparece, não quando fecha.
 */
export function AppOpenFlow() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  const session = useSession();
  const installMode = useInstallMode();
  const { leagueResult, brokenStreak } = session;

  const step = leagueResult ? 'league' : brokenStreak > 0 ? 'streak' : null;

  useEffect(() => {
    if (step === 'league' && leagueResult) markLeagueResultSeen(leagueResult.periodStart);
    if (step === 'streak') Flags.setStreakBrokenShownDate(getToday());
  }, [step, leagueResult]);

  if (step === 'league' && leagueResult) {
    return (
      <LeagueResultSheet
        result={leagueResult}
        onClose={session.dismissLeagueResult}
        onSeeLeague={() => {
          session.dismissLeagueResult();
          navigate(ROUTES.league);
        }}
      />
    );
  }

  if (step === 'streak') {
    return (
      <StreakBrokenSheet
        brokenStreak={brokenStreak}
        onStudyNow={() => {
          session.dismissBrokenStreak();
          nav.goTab(ROUTES.learn);
        }}
        onOpenHistory={() => {
          session.dismissBrokenStreak();
          navigate(ROUTES.streak);
        }}
        onDismiss={session.dismissBrokenStreak}
      />
    );
  }

  if (session.suggestInstall && installMode !== null && pathname === ROUTES.learn) {
    return <InstallSheet mode={installMode} onClose={session.markInstallSuggested} />;
  }

  return null;
}
