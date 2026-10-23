import { lazy, Suspense, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useAppNavigation } from '../hooks/useAppNavigation';
import { useAfterSheet } from '../hooks/useAfterSheet';
import { ROUTES } from '../lib/routes';
import { Flags } from '../lib/flags';
import { getToday } from '../lib/today';
import { StreakBrokenSheet } from './StreakBrokenSheet';
import { InstallSheet, useInstallMode } from './InstallSheet';

// Ligas (domínio, confete, estilos) só baixam quando há resultado para mostrar
const LeagueResultSheet = lazy(() => import('./LeagueResultSheet').then(m => ({ default: m.LeagueResultSheet })));

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
  const afterSheet = useAfterSheet();
  const { leagueResult, brokenStreak } = session;

  const step = leagueResult ? 'league' : brokenStreak > 0 ? 'streak' : null;

  useEffect(() => {
    if (step === 'league' && leagueResult) {
      void import('../lib/leagueLocal').then(m => m.markLeagueResultSeen(leagueResult.periodStart));
    }
    if (step === 'streak') Flags.setStreakBrokenShownDate(getToday());
  }, [step, leagueResult]);

  if (step === 'league' && leagueResult) {
    return (
      <Suspense fallback={null}>
        <LeagueResultSheet
          result={leagueResult}
          onClose={session.dismissLeagueResult}
          onSeeLeague={() => {
            session.dismissLeagueResult();
            afterSheet(() => navigate(ROUTES.league));
          }}
        />
      </Suspense>
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
          afterSheet(() => navigate(ROUTES.streak));
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
