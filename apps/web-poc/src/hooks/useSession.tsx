import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { completeLesson } from '@usecases/completeLesson.js';
import { course } from '../lib/course';
import { getToday } from '../lib/today';
import { Flags } from '../lib/flags';
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
  /** Sequência perdida detectada ao abrir o app (0 = nada a mostrar). */
  brokenStreak: number;
  dismissBrokenStreak: () => void;
  /** Já houve lição concluída e a sugestão de instalar ainda não apareceu. */
  suggestInstall: boolean;
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
  children: ReactNode;
}

export function SessionProvider({ repo, userId, brokenStreak: initialBroken, children }: ProviderProps) {
  const [completion, setCompletion] = useState<CompletionData | null>(null);
  const [unitCompletion, setUnitCompletion] = useState<UnitCompletionData | null>(null);
  const [courseCompletion, setCourseCompletion] = useState<CourseCompletionData | null>(null);
  const [brokenStreak, setBrokenStreak] = useState(initialBroken);
  const [suggestInstall, setSuggestInstall] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const finishLesson = useCallback(async (result: LessonSessionResult): Promise<AfterLesson> => {
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

    // Salva o valor da sequencia para detectar quebra na proxima abertura
    if (outcome.streak > 0) Flags.setLastStreakValue(outcome.streak);
    if (!Flags.installSuggested()) setSuggestInstall(true);

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
      const unitXp = lessonUnit.lessons.reduce((acc, l) => acc + l.xpReward, 0);
      setUnitCompletion({ unitId: lessonUnit.id, signsLearned: unitSignCount, xpGained: unitXp });
      return 'unit';
    }
    return null;
  }, [repo, userId]);

  const dismissBrokenStreak = useCallback(() => setBrokenStreak(0), []);

  const markInstallSuggested = useCallback(() => {
    Flags.setInstallSuggested();
    setSuggestInstall(false);
  }, []);

  const showNotice = useCallback((key: string) => setNotice(key), []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  const value = useMemo<SessionValue>(() => ({
    repo, userId, completion, unitCompletion, courseCompletion, brokenStreak, dismissBrokenStreak,
    suggestInstall, markInstallSuggested, finishLesson, notice, showNotice, dismissNotice,
  }), [repo, userId, completion, unitCompletion, courseCompletion, brokenStreak, dismissBrokenStreak,
    suggestInstall, markInstallSuggested, finishLesson, notice, showNotice, dismissNotice]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession deve ser usado dentro de SessionProvider');
  return ctx;
}
