import { useEffect, useState } from 'react';
import {
  Navigate, Outlet, ScrollRestoration, useLocation, useNavigate, useParams, useRouteError,
  type RouteObject,
} from 'react-router-dom';
import { isOnboarded } from './lib/auth';
import { course, loadLessonExercises, type Exercise } from './lib/content';
import { ROUTES, TAB_PATHS, sectionForPath } from './lib/routes';
import { useSession } from './hooks/useSession';
import { HistoryTracker, useAppNavigation } from './hooks/useAppNavigation';
import { useT } from './i18n';
import { Nav } from './components/Nav';
import { Icon } from './components/Icon';
import { StreakBrokenSheet } from './components/StreakBrokenSheet';
import { InstallSheet, useInstallMode } from './components/InstallSheet';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { CourseMapScreen } from './screens/CourseMapScreen';
import { LessonScreen, type LessonSessionResult } from './screens/LessonScreen';
import { LessonCompletionScreen } from './screens/LessonCompletionScreen';
import { UnitCompletionScreen } from './screens/UnitCompletionScreen';
import { CourseCompletionScreen } from './screens/CourseCompletionScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { SocialScreen } from './screens/SocialScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { StreakScreen } from './screens/StreakScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CameraScreen } from './screens/CameraScreen';

/* ---------- moldura ---------- */

/** Raiz de todas as rotas: rolagem (topo ao abrir tela nova, posição de volta ao voltar) e histórico. */
function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <HistoryTracker />
      <Outlet />
    </>
  );
}

function HomeRedirect() {
  return <Navigate to={isOnboarded() ? ROUTES.learn : ROUTES.onboarding} replace />;
}

/** Sem onboarding feito, qualquer rota cai nas boas-vindas. */
function RequireOnboarded() {
  if (!isOnboarded()) return <Navigate to={ROUTES.onboarding} replace />;
  return <Outlet />;
}

function Loading() {
  const { t } = useT();
  return (
    <div className="app-loading">
      <p>{t('common.loading')}</p>
    </div>
  );
}

/** Erro ao montar uma rota (por exemplo, pedaço do app que não baixou). Nunca mostra código de erro. */
function RouteError() {
  const { t } = useT();
  const error = useRouteError();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="app-loading route-error">
      <Icon name="cloud_off" size="64px" />
      <p>{t('routeError.title')}</p>
      <button className="btn btn-primary route-error-btn" onClick={() => window.location.reload()}>
        <Icon name="replay" /> {t('routeError.retry')}
      </button>
    </div>
  );
}

/** Layout com a barra de abas (Aprender, Praticar, Social, Perfil e a câmera de Praticar). */
function TabsLayout() {
  const { pathname } = useLocation();
  const nav = useAppNavigation();
  const session = useSession();
  const installMode = useInstallMode();
  // Sugere instalar ao voltar para o mapa depois da primeira lição concluída (decisão 13)
  const showInstall = session.suggestInstall && installMode !== null && pathname === ROUTES.learn
    && session.brokenStreak === 0;

  return (
    <div className="app-layout">
      {session.brokenStreak > 0 && (
        <StreakBrokenSheet
          brokenStreak={session.brokenStreak}
          onStudyNow={() => {
            session.dismissBrokenStreak();
            nav.goTab(ROUTES.learn);
          }}
          onDismiss={session.dismissBrokenStreak}
        />
      )}
      {showInstall && (
        <InstallSheet mode={installMode} onClose={session.markInstallSuggested} />
      )}
      <Nav active={sectionForPath(pathname)} onNavigate={section => nav.goTab(TAB_PATHS[section])} />
      {/* key: o fade de troca de aba (style.css) roda a cada tela */}
      <main className="main-content" key={pathname}>
        <Outlet />
      </main>
    </div>
  );
}

/* ---------- abas ---------- */

function LearnRoute() {
  const { repo, userId } = useSession();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  return (
    <CourseMapScreen
      repo={repo}
      userId={userId}
      onStartLesson={lessonId => navigate(ROUTES.lesson(lessonId))}
      onOpenStreak={() => navigate(ROUTES.streak)}
      onOpenProfile={() => nav.goTab(ROUTES.profile)}
    />
  );
}

function PracticeRoute() {
  const { repo, userId } = useSession();
  const navigate = useNavigate();
  return <PracticeScreen userId={userId} repo={repo} onOpenCamera={() => navigate(ROUTES.camera)} />;
}

function ProfileRoute() {
  const { repo, userId } = useSession();
  const navigate = useNavigate();
  return (
    <ProfileScreen
      userId={userId}
      repo={repo}
      onOpenStreak={() => navigate(ROUTES.streak)}
      onOpenAchievements={() => navigate(ROUTES.achievements)}
      onOpenSettings={() => navigate(ROUTES.settings)}
    />
  );
}

function CameraRoute() {
  const { t } = useT();
  const nav = useAppNavigation();
  return (
    <>
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={() => nav.back(ROUTES.practice)} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('app.cameraTitle')}</h1>
      </div>
      <CameraScreen />
    </>
  );
}

/* ---------- telas sem abas ---------- */

function OnboardingRoute() {
  const navigate = useNavigate();
  if (isOnboarded()) return <Navigate to={ROUTES.learn} replace />;
  return <OnboardingScreen onDone={() => navigate(ROUTES.learn, { replace: true })} />;
}

function StreakRoute() {
  const { repo, userId } = useSession();
  const nav = useAppNavigation();
  return <StreakScreen userId={userId} repo={repo} onBack={() => nav.back(ROUTES.learn)} />;
}

function AchievementsRoute() {
  const { repo, userId } = useSession();
  const nav = useAppNavigation();
  return <AchievementsScreen userId={userId} repo={repo} onBack={() => nav.back(ROUTES.profile)} />;
}

function SettingsRoute() {
  const { repo, userId } = useSession();
  const nav = useAppNavigation();
  return <SettingsScreen userId={userId} repo={repo} onBack={() => nav.back(ROUTES.profile)} />;
}

/** /licao/:id: carrega os exercícios do bundle e roda a lição. Recarregar a página recomeça a lição. */
function LessonRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  const session = useSession();
  const [exercises, setExercises] = useState<Exercise[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setExercises(undefined);
    loadLessonExercises(id)
      .then(list => { if (!cancelled) setExercises(list); })
      .catch(() => { if (!cancelled) setExercises(null); });
    return () => { cancelled = true; };
  }, [id]);

  if (!course.lessonsMap[id] || exercises === null) return <Navigate to={ROUTES.learn} replace />;
  if (exercises === undefined) return <Loading />;

  async function handleComplete(result: LessonSessionResult) {
    await session.finishLesson(result);
    // Troca a lição pela conclusão: voltar dali leva ao mapa, não de volta para a lição
    navigate(ROUTES.lessonDone(result.lessonId), { replace: true });
  }

  // key: abrir outra lição pela URL zera o estado da sessão de exercícios
  return (
    <LessonScreen
      key={id}
      lessonId={id}
      exercises={exercises}
      onComplete={handleComplete}
      onExit={() => nav.backTo(ROUTES.learn)}
    />
  );
}

function LessonDoneRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  const { completion, unitCompletion, courseCompletion } = useSession();
  // Sem o resultado (página recarregada na conclusão), não há o que mostrar: volta ao mapa
  if (!completion || completion.result.lessonId !== id) return <Navigate to={ROUTES.learn} replace />;

  function handleContinue() {
    if (courseCompletion) navigate(ROUTES.courseDone, { replace: true });
    else if (unitCompletion) navigate(ROUTES.unitDone(unitCompletion.unitId), { replace: true });
    else nav.backTo(ROUTES.learn);
  }

  return <LessonCompletionScreen data={completion} onContinue={handleContinue} />;
}

function UnitDoneRoute() {
  const { id = '' } = useParams();
  const nav = useAppNavigation();
  const { unitCompletion } = useSession();
  if (!unitCompletion || unitCompletion.unitId !== id) return <Navigate to={ROUTES.learn} replace />;
  return (
    <UnitCompletionScreen
      unitId={unitCompletion.unitId}
      signsLearned={unitCompletion.signsLearned}
      xpGained={unitCompletion.xpGained}
      onContinue={() => nav.backTo(ROUTES.learn)}
    />
  );
}

function CourseDoneRoute() {
  const navigate = useNavigate();
  const { courseCompletion } = useSession();
  if (!courseCompletion) return <Navigate to={ROUTES.learn} replace />;
  const go = (path: string) => navigate(path, { replace: true });
  return (
    <CourseCompletionScreen
      xpTotal={courseCompletion.xpTotal}
      streak={courseCompletion.streak}
      signsLearned={courseCompletion.signsLearned}
      onReview={() => go(ROUTES.practice)}
      onProfile={() => go(ROUTES.profile)}
    />
  );
}

/* ---------- tabela de rotas ---------- */

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'boas-vindas', element: <OnboardingRoute /> },
      {
        element: <RequireOnboarded />,
        children: [
          {
            element: <TabsLayout />,
            children: [
              { path: 'aprender', element: <LearnRoute /> },
              { path: 'praticar', element: <PracticeRoute /> },
              { path: 'social', element: <SocialScreen /> },
              { path: 'perfil', element: <ProfileRoute /> },
              { path: 'camera', element: <CameraRoute /> },
            ],
          },
          { path: 'sequencia', element: <StreakRoute /> },
          { path: 'conquistas', element: <AchievementsRoute /> },
          { path: 'configuracoes', element: <SettingsRoute /> },
          { path: 'licao/:id', element: <LessonRoute /> },
          { path: 'licao/:id/concluida', element: <LessonDoneRoute /> },
          { path: 'unidade/:id/concluida', element: <UnitDoneRoute /> },
          { path: 'curso/concluido', element: <CourseDoneRoute /> },
        ],
      },
      { path: '*', element: <Navigate to={ROUTES.home} replace /> },
    ],
  },
];

/** Opções de compatibilidade do react-router 6 (comportamento da v7, sem avisos no console). */
export const ROUTER_FUTURE = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const;
