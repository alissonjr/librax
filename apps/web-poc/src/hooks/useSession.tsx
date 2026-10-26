import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { completeLesson } from '@usecases/completeLesson.js';
import { course } from '../lib/course';
import { getToday } from '../lib/today';
import { Flags } from '../lib/flags';
import { enqueueLessonCompletion, flushOutbox } from '../lib/sync';
import { loadInviteState, recordInviteShown, shouldSuggestInstall } from '../lib/install';
import { evaluateAppOpen, onAppReopen } from '../lib/appOpen';
import { placedLessonIds } from '../lib/placement';
import type { LeagueResult } from '../lib/leagueLocal';
import type { IdbRepo } from '../lib/idbRepo';
import type { LessonSessionResult } from '../screens/LessonScreen';
import type { CompletionData } from '../screens/LessonCompletionScreen';

export interface UnitCompletionData {
  unitId: string;
  signsLearned: number;
  xpGained: number;
}

export interface CourseCompletionData {
  xpTotal: number;
  streak: number;
  signsLearned: number;
}

/** O que a lição concluída abre depois da tela de conclusão. */
export type AfterLesson = 'unit' | 'course' | null;

interface SessionValue {
  repo: IdbRepo;
  userId: string;
  /** Resultado da última lição, para as telas de conclusão (some ao recarregar a página). */
  completion: CompletionData | null;
  unitCompletion: UnitCompletionData | null;
  courseCompletion: CourseCompletionData | null;
  /** AppOpenFlow (spec-02 12.10), passo 1: resultado da liga ainda não visto. */
  leagueResult: LeagueResult | null;
  dismissLeagueResult: () => void;
  /** AppOpenFlow, passo 2: sequência perdida detectada ao abrir o app (0 = nada a mostrar). */
  brokenStreak: number;
  dismissBrokenStreak: () => void;
  /** Hora do convite completo de instalar na tela inicial (shouldSuggestInstall, decisão 13). */
  suggestInstall: boolean;
  /** O convite foi visto e fechado: conta para a repetição (uma vez só, dias depois). */
  markInstallSuggested: () => void;
  /** Grava a lição (domínio completeLesson) e prepara as telas de conclusão. */
  finishLesson: (result: LessonSessionResult) => Promise<AfterLesson>;
  /** Aviso discreto na tela (toast, design-system 11.12): chave de tradução, ou null. */
  notice: string | null;
  showNotice: (key: string) => void;
  dismissNotice: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

interface ProviderProps {
  repo: IdbRepo;
  userId: string;
  brokenStreak: number;
  leagueResult?: LeagueResult | null;
  children: ReactNode;
}

export function SessionProvider({
  repo, userId, brokenStreak: initialBroken, leagueResult: initialLeague = null, children,
}: ProviderProps) {
  const [completion, setCompletion] = useState<CompletionData | null>(null);
  const [unitCompletion, setUnitCompletion] = useState<UnitCompletionData | null>(null);
  const [courseCompletion, setCourseCompletion] = useState<CourseCompletionData | null>(null);
  const [brokenStreak, setBrokenStreak] = useState(initialBroken);
  const [leagueResult, setLeagueResult] = useState<LeagueResult | null>(initialLeague);
  const [installInvite, setInstallInvite] = useState(loadInviteState);
  const [lessonsCompleted, setLessonsCompleted] = useState(0);
  const [installNow, setInstallNow] = useState(Date.now);

  // Lições concluídas (contando repetições) para a regra de instalar
  useEffect(() => {
    let alive = true;
    repo.getProfile(userId).then(p => {
      if (alive) setLessonsCompleted(((p as { lessonsCompleted?: number } | null)?.lessonsCompleted) ?? 0);
    }).catch(() => {});
    return () => { alive = false; };
  }, [repo, userId]);

  // Voltar ao app depois de horas conta como nova abertura: reavalia o AppOpenFlow
  useEffect(() => onAppReopen(() => {
    setInstallNow(Date.now());
    evaluateAppOpen(repo, userId).then(steps => {
      if (steps.leagueResult) setLeagueResult(steps.leagueResult);
      if (steps.brokenStreak > 0) setBrokenStreak(steps.brokenStreak);
    }).catch(() => {});
  }), [repo, userId]);
  const [notice, setNotice] = useState<string | null>(null);

  const finishLesson = useCallback(async (result: LessonSessionResult): Promise<AfterLesson> => {
    const today = getToday();
    const allLessons = course.units.flatMap(u => u.lessons);
    const isLastLesson = allLessons[allLessons.length - 1]?.id === result.lessonId;

    const lessonUnit = course.units.find(u => u.lessons.some(l => l.id === result.lessonId));
    const isLastInUnit = lessonUnit?.lessons[lessonUnit.lessons.length - 1]?.id === result.lessonId;
    // Alfabeto completo = fim da U1 (alphabetLessonId do servidor), não o fim do curso. O teste de
    // nivelamento nunca dá a conquista: se pulou a última da U1, ela vem ao refazê-la.
    const alphabetComplete = lessonUnit?.id === course.units[0]?.id && isLastInUnit;

    // Id da tentativa: o servidor usa para não aplicar a mesma conclusão duas vezes
    const lessonAttemptId = crypto.randomUUID();
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

    // Fila offline (sync.ts): com conta vai para o servidor; como convidado fica guardada até a
    // migração. Falha aqui nunca atrapalha a conclusão, que já está salva no aparelho.
    enqueueLessonCompletion({
      lessonAttemptId,
      lessonId: result.lessonId,
      today,
      score: result.score,
      reviewed: result.reviewed,
      signsLearnedDelta: result.signsLearnedDelta,
      exerciseStats: result.exerciseStats,
      cameraStats: result.cameraStats,
    })
      .then(() => flushOutbox())
      .catch(() => {});

    setLessonsCompleted(n => n + 1);
    setInstallNow(Date.now());

    setCompletion({
      result,
      xpAwarded: outcome.xpAwarded,
      xpTotal: outcome.xpTotal,
      streak: outcome.streak,
      goalMet: outcome.goalMet,
      achievementsEarned: outcome.achievementsEarned,
    });
    setUnitCompletion(null);
    setCourseCompletion(null);

    if (isLastLesson) {
      // A tela de curso concluído aparece uma vez só; a flag fica no localStorage (spec-03 11.15).
      // Refazer a última lição volta ao mapa, sem a tela da unidade.
      if (Flags.courseA1Completed()) return null;
      Flags.setCourseA1Completed();
      setCourseCompletion({
        xpTotal: outcome.xpTotal,
        streak: outcome.streak,
        // curso inteiro concluido: todos os sinais do curso (antes mostrava so os da ultima licao)
        signsLearned: course.signsOrder.length,
      });
      return 'course';
    }
    if (isLastInUnit && lessonUnit) {
      // Sinais novos da unidade: sem repetir e sem os que vieram de unidades anteriores
      // (a U4 revisa letras da U1 na soletracao e a U14 tem licoes de revisao).
      const unitIdx = course.units.indexOf(lessonUnit);
      const seenBefore = new Set(course.units.slice(0, unitIdx).flatMap(u => u.lessons.flatMap(l => l.signIds)));
      const unitSignCount = new Set(
        lessonUnit.lessons.flatMap(l => l.signIds).filter(id => !seenBefore.has(id)),
      ).size;
      // XP que a unidade deu de fato: as lições puladas pelo teste de nivelamento não deram XP
      const placed = new Set(await placedLessonIds(repo, userId, lessonUnit.lessons));
      const unitXp = lessonUnit.lessons
        .filter(l => l.id === result.lessonId || !placed.has(l.id))
        .reduce((acc, l) => acc + l.xpReward, 0);
      setUnitCompletion({ unitId: lessonUnit.id, signsLearned: unitSignCount, xpGained: unitXp });
      return 'unit';
    }
    return null;
  }, [repo, userId]);

  const dismissBrokenStreak = useCallback(() => setBrokenStreak(0), []);
  const dismissLeagueResult = useCallback(() => setLeagueResult(null), []);

  // Para todos, com ou sem conta: depois da primeira lição e, dispensado, mais uma vez só
  const suggestInstall = shouldSuggestInstall({ invite: installInvite, lessonsCompleted, now: installNow });

  const markInstallSuggested = useCallback(() => {
    setInstallInvite(recordInviteShown(lessonsCompleted));
  }, [lessonsCompleted]);

  const showNotice = useCallback((key: string) => setNotice(key), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionValue>(() => ({
    repo, userId, completion, unitCompletion, courseCompletion, leagueResult, dismissLeagueResult,
    brokenStreak, dismissBrokenStreak, suggestInstall, markInstallSuggested, finishLesson,
    notice, showNotice, dismissNotice,
  }), [repo, userId, completion, unitCompletion, courseCompletion, leagueResult, dismissLeagueResult,
    brokenStreak, dismissBrokenStreak, suggestInstall, markInstallSuggested, finishLesson,
    notice, showNotice, dismissNotice]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession deve ser usado dentro de SessionProvider');
  return ctx;
}
