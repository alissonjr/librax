import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  Navigate, Outlet, ScrollRestoration, useLocation, useNavigate, useParams, useRouteError,
  type RouteObject,
} from 'react-router-dom';
import { isOnboarded } from './lib/auth';
import { shouldOfferAccount, useAccount } from './lib/account';
import { Flags } from './lib/flags';
import { getToday } from './lib/today';
import { reportLessonAbandon } from './lib/sync';
import { course } from './lib/course';
import { isLessonOpen, loadCourseProgress } from './lib/progress';
import type { Exercise } from './lib/content';
import { clearLessonRun, contentVersion, loadLessonRun, saveLessonRun, type LessonProgress, type LessonRun } from './lib/lessonRun';
import { ROUTES, TAB_PATHS, sectionForPath } from './lib/routes';
import { splashShellReady, splashStep } from './lib/splash';
import { useSession } from './hooks/useSession';
import { HistoryTracker, useAppNavigation } from './hooks/useAppNavigation';
import { useLessonExit } from './hooks/useLessonExit';
import { useAfterSheet } from './hooks/useAfterSheet';
import { DialogProvider } from './hooks/useDialog';
import { useT } from './i18n';
import { Nav } from './components/Nav';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { Toast } from './components/Toast';
import { ScreenSkeleton } from './components/ScreenSkeleton';
import { AppOpenFlow } from './components/AppOpenFlow';
import { ConvertAccountSheet } from './components/ConvertAccountSheet';
import type { LessonSessionResult } from './screens/LessonScreen';
import type { AuthMode } from './screens/AuthScreen';
import type { LegalDocId } from './legal/documents';

/* ---------- telas sob demanda ---------- */

/**
 * Tela carregada sob demanda: cada uma vira um pedaço do build e o JS inicial fica só com o
 * roteador, as molduras e a barra de abas (meta da W2: abaixo de 200 KB gzip). Os pedaços entram no
 * precache do service worker, então continuam abrindo offline. `preload` começa a baixar antes de a
 * rota montar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lazyScreen<K extends string, C extends ComponentType<any>>(load: () => Promise<Record<K, C>>, name: K) {
  let pending: Promise<{ default: C }> | null = null;
  const preload = () => {
    pending ??= load().then(
      m => {
        // Tela de abertura: o código da primeira tela chegou (as próximas não mudam nada)
        splashStep('screen');
        return { default: m[name] };
      },
      (err: unknown) => { pending = null; throw err; },
    );
    return pending;
  };
  return Object.assign(lazy(preload), { preload });
}

const OnboardingScreen = lazyScreen(() => import('./screens/OnboardingScreen'), 'OnboardingScreen');
const CourseMapScreen = lazyScreen(() => import('./screens/CourseMapScreen'), 'CourseMapScreen');
const LessonScreen = lazyScreen(() => import('./screens/LessonScreen'), 'LessonScreen');
const LessonCompletionScreen = lazyScreen(() => import('./screens/LessonCompletionScreen'), 'LessonCompletionScreen');
const UnitCompletionScreen = lazyScreen(() => import('./screens/UnitCompletionScreen'), 'UnitCompletionScreen');
const CourseCompletionScreen = lazyScreen(() => import('./screens/CourseCompletionScreen'), 'CourseCompletionScreen');
const PracticeScreen = lazyScreen(() => import('./screens/PracticeScreen'), 'PracticeScreen');
const SocialScreen = lazyScreen(() => import('./screens/SocialScreen'), 'SocialScreen');
const ProfileScreen = lazyScreen(() => import('./screens/ProfileScreen'), 'ProfileScreen');
const StreakScreen = lazyScreen(() => import('./screens/StreakScreen'), 'StreakScreen');
const AchievementsScreen = lazyScreen(() => import('./screens/AchievementsScreen'), 'AchievementsScreen');
const SettingsScreen = lazyScreen(() => import('./screens/SettingsScreen'), 'SettingsScreen');
const CameraStatsScreen = lazyScreen(() => import('./screens/CameraStatsScreen'), 'CameraStatsScreen');
const CameraScreen = lazyScreen(() => import('./screens/CameraScreen'), 'CameraScreen');
const LeagueScreen = lazyScreen(() => import('./screens/LeagueScreen'), 'LeagueScreen');
const AuthScreen = lazyScreen(() => import('./screens/AuthScreen'), 'AuthScreen');
const LegalScreen = lazyScreen(() => import('./screens/LegalScreen'), 'LegalScreen');
// Leve: só espera configureAuth() e a sessão; nenhum redirecionamento antes disso
const AuthCallbackScreen = lazyScreen(() => import('./screens/AuthCallbackScreen'), 'AuthCallbackScreen');

// O mapa é a tela de partida: começa a baixar junto com a abertura do banco local (App.tsx),
// sem esperar o roteador montar, para não somar uma ida à rede no LCP.
const initialPath = typeof window !== 'undefined' ? window.location.pathname : '';
if (initialPath === ROUTES.home || initialPath === ROUTES.learn) {
  void CourseMapScreen.preload().catch(() => {});
}

/* ---------- moldura ---------- */

/**
 * Ao trocar de rota, o foco vai para o título da nova tela e o título da aba do navegador muda junto,
 * para o leitor de tela anunciar a troca (design-system 11.13). A primeira tela não rouba o foco.
 * Algumas telas carregam dados antes de mostrar o título: tenta de novo por um instante.
 */
function RouteAnnouncer() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useEffect(() => {
    const isFirst = first.current;
    first.current = false;
    let tries = 0;
    let timer = 0;
    const apply = () => {
      const h1 = document.querySelector<HTMLElement>('main h1, .lesson-screen h1, #app h1');
      if (!h1 && tries++ < 10) {
        timer = window.setTimeout(apply, 100);
        return;
      }
      const title = h1?.textContent?.trim();
      document.title = title && title !== 'Librax' ? `${title} | Librax` : 'Librax';
      if (h1 && !isFirst) {
        if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
        h1.focus({ preventScroll: true });
      }
    };
    apply();
    return () => window.clearTimeout(timer);
  }, [pathname]);
  return null;
}

/** Aviso discreto da sessão (por exemplo, lição bloqueada aberta pelo endereço). */
function NoticeToast() {
  const { t } = useT();
  const { notice, dismissNotice } = useSession();
  return notice ? <Toast message={t(notice)} onDone={dismissNotice} /> : null;
}

/**
 * Raiz de todas as rotas: rolagem (topo ao abrir tela nova, posição de volta ao voltar) e histórico.
 * Os diálogos (useDialog) ficam aqui dentro do roteador porque o voltar os fecha (useCloseOnBack).
 */
function RootLayout() {
  // Tela de abertura: a primeira rota montou; ela sai quando não houver skeleton na tela
  useEffect(() => { splashShellReady(); }, []);
  return (
    <DialogProvider>
      <ScrollRestoration />
      <HistoryTracker />
      <RouteAnnouncer />
      <Suspense fallback={<ScreenSkeleton />}>
        <Outlet />
      </Suspense>
      <NoticeToast />
    </DialogProvider>
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

  return (
    <div className="app-layout">
      {/* AppOpenFlow (spec-02 12.10): liga, sequência e, por último, instalar */}
      <AppOpenFlow />
      <Nav active={sectionForPath(pathname)} onNavigate={section => nav.goTab(TAB_PATHS[section])} />
      {/* key: o fade de troca de aba (style.css) roda a cada tela */}
      <main className="main-content" key={pathname}>
        {/* Suspense aqui dentro: a barra de abas fica na tela enquanto o pedaço da aba baixa */}
        <Suspense fallback={<ScreenSkeleton />}>
          <Outlet />
        </Suspense>
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

function SocialRoute() {
  const { repo, userId } = useSession();
  const navigate = useNavigate();
  return <SocialScreen userId={userId} repo={repo} onOpenLeague={() => navigate(ROUTES.league)} />;
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
      onOpenLeague={() => navigate(ROUTES.league)}
      onOpenAccount={mode => navigate(mode === 'login' ? ROUTES.login : ROUTES.register)}
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
  return (
    <OnboardingScreen
      onDone={() => navigate(ROUTES.learn, { replace: true })}
      onLogin={() => navigate(ROUTES.login)}
    />
  );
}

/**
 * /entrar e /criar-conta (spec-02 12.3). `state.returnTo` diz para onde seguir depois (o convite
 * do fim da lição passa a próxima tela do fluxo); sem ele, volta para a tela anterior.
 */
function AuthRoute({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const nav = useAppNavigation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const leave = () => (returnTo ? nav.backTo(returnTo) : nav.back(ROUTES.home));
  return (
    <AuthScreen
      mode={mode}
      onSwitchMode={(next: AuthMode) => navigate(next === 'login' ? ROUTES.login : ROUTES.register, {
        replace: true,
        state: location.state,
      })}
      onDone={leave}
      onBack={leave}
    />
  );
}

/** /auth/callback: conclui a volta do Google antes de qualquer redirecionamento, depois vai ao mapa. */
function AuthCallbackRoute() {
  const navigate = useNavigate();
  return (
    <AuthCallbackScreen
      onDone={() => navigate(ROUTES.learn, { replace: true })}
      onRetry={() => navigate(ROUTES.login, { replace: true })}
    />
  );
}

/**
 * /privacidade e /termos: abrem pelo link direto (o Google pede a URL da política na tela de
 * consentimento), sem conta e sem onboarding. Voltar leva à tela de origem ou, sem histórico, ao início.
 */
function LegalRoute({ doc }: { doc: LegalDocId }) {
  const nav = useAppNavigation();
  return <LegalScreen doc={doc} onBack={() => nav.back(ROUTES.home)} />;
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

function LeagueRoute() {
  const { repo, userId, dismissLeagueResult } = useSession();
  const nav = useAppNavigation();
  // A LeagueScreen mostra o resultado pendente sozinha: o AppOpenFlow não repete
  useEffect(() => dismissLeagueResult(), [dismissLeagueResult]);
  return (
    <LeagueScreen
      userId={userId}
      repo={repo}
      onBack={() => nav.back(ROUTES.social)}
      onStudy={() => nav.backTo(ROUTES.learn)}
    />
  );
}

function SettingsRoute() {
  const { repo, userId, showNotice } = useSession();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  return (
    <SettingsScreen
      userId={userId}
      repo={repo}
      onBack={() => nav.back(ROUTES.profile)}
      onNotice={showNotice}
      onOpenAccount={mode => navigate(mode === 'login' ? ROUTES.login : ROUTES.register)}
      onOpenCameraStats={() => navigate(ROUTES.cameraStats)}
    />
  );
}

/** /configuracoes/camera: tentativas e pulos por sinal nos exercícios de câmera (lib/cameraStats.ts). */
function CameraStatsRoute() {
  const nav = useAppNavigation();
  return <CameraStatsScreen onBack={() => nav.back(ROUTES.settings)} />;
}

/**
 * /licao/:id: carrega os exercícios do bundle e roda a lição. Recarregar a página retoma a lição em
 * andamento (lib/lessonRun.ts) no mesmo exercício e com os mesmos sorteios; concluir ou confirmar
 * "Sair da lição?" apaga o que estava guardado.
 */
function LessonRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  const session = useSession();
  const { t } = useT();
  const { repo, userId, showNotice } = session;
  // undefined: carregando; null: lição sem arquivo; 'locked': bloqueada no mapa
  const [exercises, setExercises] = useState<Exercise[] | null | 'locked' | undefined>(undefined);
  // Lição em andamento retomada e versão do conteúdo (para guardar o andamento)
  const [resume, setResume] = useState<LessonRun | null>(null);
  const version = useRef('');
  // Concluída ou abandonada: nada mais é guardado (a tela ainda pode renderizar depois do fim)
  const runClosed = useRef(false);
  // Próximo exercício a abrir (o último progresso guardado), para contar onde a pessoa saiu
  const lastIndex = useRef(0);
  const ready = Array.isArray(exercises) && exercises.length > 0;
  const exit = useLessonExit(ready);

  useEffect(() => {
    let cancelled = false;
    setExercises(undefined);
    setResume(null);
    runClosed.current = false;
    lastIndex.current = 0;
    async function load(): Promise<Exercise[] | null | 'locked'> {
      // content.ts traz os sinais (signs.json): só baixa quando uma lição abre. A tela da lição
      // baixa junto, para aparecer inteira de uma vez.
      const [content, , progress] = await Promise.all([
        import('./lib/content'), LessonScreen.preload(), loadCourseProgress(repo, userId),
      ]);
      // Guarda: a lição bloqueada no mapa não abre pelo endereço (mesma regra do mapa)
      if (course.lessonsMap[id] && !isLessonOpen(progress, id)) return 'locked';
      const lesson = course.lessonsMap[id];
      // As glosas do modelo de sinais com movimento e as letras do modelo das letras com movimento
      // (se houver) decidem quais perform_sign a câmera avalia
      const [bundle] = lesson
        ? await Promise.all([content.loadLessonBundle(id), content.loadSignIndex(), content.loadLetterMotionIndex()])
        : [null];
      if (!lesson || !bundle) return null;
      version.current = contentVersion(bundle);
      // Página recarregada no meio da lição: os mesmos exercícios (e sorteios), do ponto onde parou
      const saved = loadLessonRun(userId, id, version.current);
      if (saved && saved.exercises.every(ex => content.signsMap[ex.signId])) {
        if (!cancelled) {
          setResume(saved);
          lastIndex.current = saved.index;
        }
        return saved.exercises;
      }
      return content.resolveExercises(bundle, lesson.signIds);
    }
    load()
      .then(result => { if (!cancelled) setExercises(result); })
      .catch(() => { if (!cancelled) setExercises(null); });
    return () => { cancelled = true; };
  }, [id, repo, userId]);

  // Bloqueada: volta ao mapa (voltando no histórico se veio de lá) com um aviso discreto. O ref
  // evita voltar duas vezes quando o efeito roda de novo (StrictMode em desenvolvimento).
  const leftLocked = useRef(false);
  useEffect(() => {
    if (exercises !== 'locked' || leftLocked.current) return;
    leftLocked.current = true;
    showNotice('courseMap.lessonLocked');
    nav.backTo(ROUTES.learn);
  }, [exercises, showNotice, nav]);

  if (!course.lessonsMap[id] || exercises === null) return <Navigate to={ROUTES.learn} replace />;
  if (!Array.isArray(exercises)) return <ScreenSkeleton />;

  const lessonExercises = exercises;
  function handleProgress(progress: LessonProgress) {
    lastIndex.current = progress.index;
    if (runClosed.current) return;
    saveLessonRun(userId, { lessonId: id, version: version.current, exercises: lessonExercises, ...progress });
  }

  function confirmExit() {
    runClosed.current = true;
    clearLessonRun(userId, id);
    // Onde a pessoa parou, para o painel de administração (só com conta; sem esperar a rede)
    const index = Math.min(lastIndex.current, lessonExercises.length - 1);
    void reportLessonAbandon({
      lessonId: id,
      today: getToday(),
      exerciseIndex: index,
      exerciseCount: lessonExercises.length,
      exerciseType: lessonExercises[index]?.type ?? null,
    });
    exit.confirm();
  }

  async function handleComplete(result: LessonSessionResult) {
    // Libera a saída antes de ir para a conclusão
    exit.finish();
    runClosed.current = true;
    clearLessonRun(userId, id);
    await session.finishLesson(result);
    // Troca a lição pela conclusão: voltar dali leva ao mapa, não de volta para a lição
    navigate(ROUTES.lessonDone(result.lessonId), { replace: true });
  }

  // key: abrir outra lição pela URL zera o estado da sessão de exercícios. Suspense próprio: se a
  // tela ainda suspender por um instante, só ela vira skeleton e esta rota (com o bloqueio da
  // saída) continua na tela.
  return (
    <>
      <Suspense fallback={<ScreenSkeleton />}>
        <LessonScreen
          key={id}
          lessonId={id}
          exercises={exercises}
          onComplete={handleComplete}
          onExit={() => nav.backTo(ROUTES.learn)}
          initial={resume ?? undefined}
          onProgress={handleProgress}
        />
      </Suspense>
      <Dialog
        isOpen={exit.asking}
        title={t('lessonScreen.exitTitle')}
        message={t('lessonScreen.exitMessage')}
        confirmLabel={t('lessonScreen.exitConfirm')}
        cancelLabel={t('common.continue')}
        onConfirm={confirmExit}
        onCancel={exit.cancel}
        closeOnBack={false}
      />
    </>
  );
}

function LessonDoneRoute() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const nav = useAppNavigation();
  const { completion, unitCompletion, courseCompletion } = useSession();
  const account = useAccount();
  const [offerAccount, setOfferAccount] = useState(false);
  const afterSheet = useAfterSheet();
  // Sem o resultado (página recarregada na conclusão), não há o que mostrar: volta ao mapa
  if (!completion || completion.result.lessonId !== id) return <Navigate to={ROUTES.learn} replace />;

  const nextPath = courseCompletion ? ROUTES.courseDone
    : unitCompletion ? ROUTES.unitDone(unitCompletion.unitId)
      : null;

  function proceed() {
    if (nextPath) navigate(nextPath, { replace: true });
    else nav.backTo(ROUTES.learn);
  }

  // Convidado: o convite para criar conta aparece depois do "Continuar" (spec-02 12.2)
  function handleContinue() {
    if (shouldOfferAccount(account.status, Flags.accountOfferDismissedDate(), getToday())) setOfferAccount(true);
    else proceed();
  }

  return (
    <>
      <LessonCompletionScreen data={completion} onContinue={handleContinue} />
      {offerAccount && (
        <ConvertAccountSheet
          firstLesson={completion.achievementsEarned.includes('PRIMEIRA_LICAO')}
          onCreateWithEmail={() => {
            setOfferAccount(false);
            // Troca a conclusão pela tela de conta: concluir leva à próxima tela do fluxo
            afterSheet(() => navigate(ROUTES.register, {
              replace: true,
              state: { returnTo: nextPath ?? ROUTES.learn },
            }));
          }}
          onSkip={() => {
            Flags.setAccountOfferDismissedDate(getToday());
            setOfferAccount(false);
            afterSheet(proceed);
          }}
          onClose={() => setOfferAccount(false)}
        />
      )}
    </>
  );
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
      // Conta e volta do Google: fora do onboarding, para o ?code= não se perder num redirecionamento
      { path: 'entrar', element: <AuthRoute mode="login" /> },
      { path: 'criar-conta', element: <AuthRoute mode="register" /> },
      { path: 'auth/callback', element: <AuthCallbackRoute /> },
      // Política e Termos: fora do onboarding, para abrirem por link direto
      { path: 'privacidade', element: <LegalRoute doc="privacy" /> },
      { path: 'termos', element: <LegalRoute doc="terms" /> },
      {
        element: <RequireOnboarded />,
        children: [
          {
            element: <TabsLayout />,
            children: [
              { path: 'aprender', element: <LearnRoute /> },
              { path: 'praticar', element: <PracticeRoute /> },
              { path: 'social', element: <SocialRoute /> },
              { path: 'perfil', element: <ProfileRoute /> },
              { path: 'camera', element: <CameraRoute /> },
            ],
          },
          { path: 'social/liga', element: <LeagueRoute /> },
          { path: 'sequencia', element: <StreakRoute /> },
          { path: 'conquistas', element: <AchievementsRoute /> },
          { path: 'configuracoes', element: <SettingsRoute /> },
          { path: 'configuracoes/camera', element: <CameraStatsRoute /> },
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
