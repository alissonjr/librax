import { useState, useEffect, useCallback } from 'react';
import { getDb } from './lib/db';
import { IdbRepo } from './lib/idbRepo';
import { getUserId, isOnboarded } from './lib/auth';
import { getToday } from './lib/today';
import { course } from './lib/content';
import { DialogProvider } from './hooks/useDialog';
import { Nav, type NavSection } from './components/Nav';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { CourseMapScreen } from './screens/CourseMapScreen';
import { LessonScreen, type LessonSessionResult } from './screens/LessonScreen';
import { LessonCompletionScreen, type CompletionData } from './screens/LessonCompletionScreen';
import { UnitCompletionScreen } from './screens/UnitCompletionScreen';
import { CourseCompletionScreen } from './screens/CourseCompletionScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { SocialScreen } from './screens/SocialScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { StreakScreen } from './screens/StreakScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CameraScreen } from './screens/CameraScreen';
import { LeagueScreen } from './screens/LeagueScreen';
import { completeLesson } from '@usecases/completeLesson.js';
import { newProfile } from '@domain/profile.js';
import { StreakBrokenSheet } from './components/StreakBrokenSheet';
import { Flags } from './lib/flags';
import { useT } from './i18n';
import { Icon } from './components/Icon';

type AppScreen =
  | 'onboarding'
  | 'main'
  | 'lesson'
  | 'completion'
  | 'unitCompletion'
  | 'courseCompletion'
  | 'streak'
  | 'achievements'
  | 'settings'
  | 'camera'
  | 'league';

interface UnitCompletionData {
  unitId: string;
  signsLearned: number;
  xpGained: number;
}

interface CourseCompletionData {
  xpTotal: number;
  streak: number;
  signsLearned: number;
}

interface AppState {
  screen: AppScreen;
  navSection: NavSection;
  lessonId: string | null;
  completion: CompletionData | null;
  unitCompletion: UnitCompletionData | null;
  courseCompletion: CourseCompletionData | null;
  repo: IdbRepo | null;
  userId: string;
  ready: boolean;
  showStreakBroken: boolean;
  brokenStreakValue: number;
}

export function App() {
  const { t } = useT();
  const [state, setState] = useState<AppState>({
    screen: 'onboarding',
    navSection: 'aprender',
    lessonId: null,
    completion: null,
    unitCompletion: null,
    courseCompletion: null,
    repo: null,
    userId: '',
    ready: false,
    showStreakBroken: false,
    brokenStreakValue: 0,
  });

  useEffect(() => {
    async function init() {
      const db = await getDb();
      const userId = getUserId();
      const repo = new IdbRepo(db, userId);

      const profile = await repo.getProfile(userId);
      if (!profile) {
        await repo.saveProfile({ ...newProfile(userId), achievements: [] });
      }

      if ('storage' in navigator && 'persist' in navigator.storage) {
        navigator.storage.persist().catch(() => {});
      }

      // Detecta streak quebrado para mostrar o StreakBrokenSheet
      let showStreakBroken = false;
      let brokenStreakValue = 0;
      if (isOnboarded()) {
        const profileData = await repo.getProfile(userId) as Record<string, unknown> | null;
        const currentStreak = (profileData?.streak as number) ?? 0;
        const lastKnown = Flags.lastStreakValue();
        const today = getToday();
        const lastShown = Flags.streakBrokenShownDate();
        if (currentStreak === 0 && lastKnown > 0 && lastShown !== today) {
          showStreakBroken = true;
          brokenStreakValue = lastKnown;
          Flags.setStreakBrokenShownDate(today);
        }
        // Atualiza o valor armazenado da sequencia
        if (currentStreak > 0) Flags.setLastStreakValue(currentStreak);
      }

      setState(s => ({
        ...s,
        repo,
        userId,
        ready: true,
        screen: isOnboarded() ? 'main' : 'onboarding',
        showStreakBroken,
        brokenStreakValue,
      }));
    }
    init();
  }, []);

  const navigate = useCallback((screen: AppScreen, extras: Partial<AppState> = {}) => {
    setState(s => ({ ...s, screen, ...extras }));
  }, []);

  const handleNav = useCallback((section: NavSection) => {
    setState(s => ({ ...s, navSection: section, screen: 'main' }));
  }, []);

  async function handleLessonComplete(result: LessonSessionResult) {
    const { repo, userId } = state;
    if (!repo) return;

    const today = getToday();
    const allLessons = course.units.flatMap(u => u.lessons);
    const isLastLesson = allLessons[allLessons.length - 1]?.id === result.lessonId;

    const lessonUnit = course.units.find(u => u.lessons.some(l => l.id === result.lessonId));
    const isLastInUnit = lessonUnit?.lessons[lessonUnit.lessons.length - 1]?.id === result.lessonId;
    // Alfabeto completo = fim da U1, nao fim do curso (o curso tem varias unidades)
    const alphabetComplete = lessonUnit?.id === course.units[0]?.id && isLastInUnit;

    const outcome = await completeLesson(
      repo,
      {
        lessons: course.lessonsMap,
        achievementRules: course.achievementRules,
        signsOrder: course.signsOrder,
      },
      {
        userId,
        lessonId: result.lessonId,
        today,
        score: result.score,
        reviewed: result.reviewed,
        signsLearnedDelta: result.signsLearnedDelta,
        alphabetComplete,
      },
    ) as {
      xpAwarded: number;
      xpTotal: number;
      streak: number;
      goalMet: boolean;
      achievementsEarned: string[];
    };

    const completionData: CompletionData = {
      result,
      xpAwarded: outcome.xpAwarded,
      xpTotal: outcome.xpTotal,
      streak: outcome.streak,
      goalMet: outcome.goalMet,
      achievementsEarned: outcome.achievementsEarned,
    };

    // Salva o valor da sequencia para detectar quebra na proxima abertura
    if (outcome.streak > 0) Flags.setLastStreakValue(outcome.streak);

    navigate('completion', { completion: completionData });

    // Store unit/course completion data for after user taps Continue
    if (isLastLesson) {
      setState(s => ({
        ...s,
        courseCompletion: {
          xpTotal: outcome.xpTotal,
          streak: outcome.streak,
          // curso inteiro concluido: todos os sinais do curso (antes mostrava so os da ultima licao)
          signsLearned: course.signsOrder.length,
        },
      }));
    } else if (isLastInUnit && lessonUnit) {
      // Sinais novos da unidade: sem repetir e sem os que vieram de unidades anteriores
      // (a U4 revisa letras da U1 na soletracao e a U14 tem licoes de revisao).
      const unitIdx = course.units.indexOf(lessonUnit);
      const seenBefore = new Set(course.units.slice(0, unitIdx).flatMap(u => u.lessons.flatMap(l => l.signIds)));
      const unitSignCount = new Set(
        lessonUnit.lessons.flatMap(l => l.signIds).filter(id => !seenBefore.has(id)),
      ).size;
      const unitXp = lessonUnit.lessons.reduce((acc, l) => acc + l.xpReward, 0);
      setState(s => ({
        ...s,
        unitCompletion: {
          unitId: lessonUnit.id,
          signsLearned: unitSignCount,
          xpGained: unitXp,
        },
      }));
    }
  }

  function handleCompletionContinue() {
    const { courseCompletion, unitCompletion } = state;
    if (courseCompletion) {
      navigate('courseCompletion');
    } else if (unitCompletion) {
      navigate('unitCompletion');
    } else {
      navigate('main', { completion: null, navSection: 'aprender' });
    }
  }

  if (!state.ready) {
    return (
      <div className="app-loading">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  if (state.screen === 'onboarding') {
    return (
      <DialogProvider>
        <OnboardingScreen onDone={() => navigate('main')} />
      </DialogProvider>
    );
  }

  if (state.screen === 'lesson' && state.lessonId) {
    return (
      <DialogProvider>
        <LessonScreen
          lessonId={state.lessonId}
          onComplete={handleLessonComplete}
          onBack={() => navigate('main')}
        />
      </DialogProvider>
    );
  }

  if (state.screen === 'completion' && state.completion) {
    return (
      <DialogProvider>
        <LessonCompletionScreen
          data={state.completion}
          onContinue={handleCompletionContinue}
        />
      </DialogProvider>
    );
  }

  if (state.screen === 'unitCompletion' && state.unitCompletion) {
    return (
      <UnitCompletionScreen
        unitId={state.unitCompletion.unitId}
        signsLearned={state.unitCompletion.signsLearned}
        xpGained={state.unitCompletion.xpGained}
        onContinue={() => navigate('main', { unitCompletion: null, navSection: 'aprender' })}
      />
    );
  }

  if (state.screen === 'courseCompletion' && state.courseCompletion) {
    return (
      <CourseCompletionScreen
        xpTotal={state.courseCompletion.xpTotal}
        streak={state.courseCompletion.streak}
        signsLearned={state.courseCompletion.signsLearned}
        onReview={() => navigate('main', { courseCompletion: null, navSection: 'praticar' })}
        onProfile={() => navigate('main', { courseCompletion: null, navSection: 'perfil' })}
      />
    );
  }

  // Sub-screens (overlay on top of nav layout)
  if (state.screen === 'streak' && state.repo) {
    return (
      <StreakScreen
        userId={state.userId}
        repo={state.repo}
        onBack={() => navigate('main')}
      />
    );
  }

  if (state.screen === 'achievements' && state.repo) {
    return (
      <AchievementsScreen
        userId={state.userId}
        repo={state.repo}
        onBack={() => navigate('main')}
      />
    );
  }

  if (state.screen === 'settings' && state.repo) {
    return (
      <SettingsScreen
        userId={state.userId}
        repo={state.repo}
        onBack={() => navigate('main')}
      />
    );
  }

  if (state.screen === 'league' && state.repo) {
    return (
      <LeagueScreen
        userId={state.userId}
        repo={state.repo}
        onBack={() => navigate('main')}
        onStudy={() => navigate('main', { navSection: 'aprender' })}
      />
    );
  }

  if (state.screen === 'camera') {
    return (
      <div className="app-layout">
        <Nav active={state.navSection} onNavigate={handleNav} />
        <main className="main-content">
          <div className="sub-screen-bar">
            <button className="back-btn" onClick={() => navigate('main')} aria-label={t('common.back')}>
              <Icon name="arrow_back" />
            </button>
            <h1>{t('app.cameraTitle')}</h1>
          </div>
          <CameraScreen />
        </main>
      </div>
    );
  }

  // Main layout with nav
  return (
    <DialogProvider>
      <div className="app-layout">
        {state.showStreakBroken && (
          <StreakBrokenSheet
            brokenStreak={state.brokenStreakValue}
            onStudyNow={() => {
              setState(s => ({ ...s, showStreakBroken: false }));
              // Navega direto para aprender
            }}
            onDismiss={() => setState(s => ({ ...s, showStreakBroken: false }))}
          />
        )}
        <Nav active={state.navSection} onNavigate={handleNav} />
        <main className="main-content">
          {state.navSection === 'aprender' && state.repo && (
            <CourseMapScreen
              repo={state.repo}
              userId={state.userId}
              onStartLesson={lessonId => navigate('lesson', { lessonId })}
              onOpenStreak={() => navigate('streak')}
              onOpenProfile={() => navigate('main', { navSection: 'perfil' })}
            />
          )}
          {state.navSection === 'praticar' && state.repo && (
            <PracticeScreen
              userId={state.userId}
              repo={state.repo}
              onOpenCamera={() => navigate('camera')}
            />
          )}
          {state.navSection === 'social' && (
            <SocialScreen
              userId={state.userId}
              repo={state.repo}
              onOpenLeague={() => navigate('league')}
            />
          )}
          {state.navSection === 'perfil' && state.repo && (
            <ProfileScreen
              userId={state.userId}
              repo={state.repo}
              onOpenStreak={() => navigate('streak')}
              onOpenAchievements={() => navigate('achievements')}
              onOpenSettings={() => navigate('settings')}
              onOpenLeague={() => navigate('league')}
            />
          )}
        </main>
      </div>
    </DialogProvider>
  );
}
