import { loadCourseProgress } from './progress';
import { setTelemetryProgress } from './telemetry';
import type { IdbRepo } from './idbRepo';

/**
 * Atualiza o retrato do progresso dos dados de uso (lib/telemetry.ts) a partir do progresso local:
 * lições concluídas de verdade (as puladas pelo teste de nivelamento não contam), XP, sequência e a
 * lição disponível agora. Só lê; nunca muda o progresso nem o caminho do curso.
 */
export async function refreshTelemetryProgress(repo: IdbRepo, userId: string): Promise<void> {
  try {
    const [profile, progress] = await Promise.all([
      repo.getProfile(userId) as Promise<{ xpTotal?: number; streak?: number } | null>,
      loadCourseProgress(repo, userId),
    ]);
    const completed = [...progress.lessonStatuses].filter(([id, st]) => st === 'completed' && !progress.placedLessons?.has(id)).length;
    setTelemetryProgress({
      lessonsCompleted: completed,
      xpTotal: profile?.xpTotal ?? 0,
      streak: profile?.streak ?? 0,
      currentLessonId: progress.nextLesson,
    });
  } catch {
    /* sem banco local: o retrato fica o último conhecido */
  }
}
