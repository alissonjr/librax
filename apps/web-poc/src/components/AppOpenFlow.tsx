import { lazy, Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { useAppNavigation } from '../hooks/useAppNavigation';
import { useAfterSheet } from '../hooks/useAfterSheet';
import { ROUTES } from '../lib/routes';
import { Flags } from '../lib/flags';
import { getToday } from '../lib/today';
import { StreakBrokenSheet } from './StreakBrokenSheet';
import { InstallSheet, useInstallMode } from './InstallSheet';
import { dismissFeedbackPrompt, loadFeedbackPrompt, shouldAskFeedback } from '../lib/feedbackPrompt';
import { usageNoticePending } from '../lib/usageNotice';

// Ligas (domínio, confete, estilos) só baixam quando há resultado para mostrar
const LeagueResultSheet = lazy(() => import('./LeagueResultSheet').then(m => ({ default: m.LeagueResultSheet })));
// Nota do app: só baixa quando for perguntar
const FeedbackSheet = lazy(() => import('./FeedbackSheet').then(m => ({ default: m.FeedbackSheet })));

/**
 * Sheets da abertura do app nas telas com abas, um de cada vez (spec-02 12.10):
 *   1. resultado da liga não visto (LeagueResultSheet);
 *   2. sequência quebrada (StreakBrokenSheet);
 *   3. depois deles, a sugestão de instalar, só no mapa (shouldSuggestInstall, decisão 13).
 *   4. por último, a nota do app (FeedbackSheet), só no mapa, quando lib/feedbackPrompt.ts diz que é
 *      hora e o aviso dos dados de uso (UsageNotice) já foi visto. Nunca numa lição nem na câmera.
 * Liga e sequência gravam "já visto" ao aparecer. O convite de instalação registra a dispensa
 * ao fechar, para contar os dias até a próxima oferta.
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
  const [prompt, setPrompt] = useState(loadFeedbackPrompt);
  // Aberto fica aberto até a pessoa fechar (o "Obrigado" aparece depois de marcar como respondida)
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const installStep = session.suggestInstall && installMode !== null && pathname === ROUTES.learn;
  const wantFeedback = step === null && !installStep && pathname === ROUTES.learn
    && shouldAskFeedback(prompt, session.lessonsCompleted) && !usageNoticePending();

  useEffect(() => {
    if (wantFeedback) setFeedbackOpen(true);
  }, [wantFeedback]);

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

  if (installStep) {
    return <InstallSheet mode={installMode} onClose={session.markInstallSuggested} />;
  }

  if (feedbackOpen) {
    return (
      <Suspense fallback={null}>
        <FeedbackSheet
          onDismiss={() => {
            setPrompt(dismissFeedbackPrompt(session.lessonsCompleted));
            setFeedbackOpen(false);
          }}
          onDone={() => {
            setPrompt(loadFeedbackPrompt());
            setFeedbackOpen(false);
          }}
        />
      </Suspense>
    );
  }

  return null;
}
