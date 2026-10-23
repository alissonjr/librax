import { course } from './course';
import type { IdbRepo } from './idbRepo';

export type LessonStatus = 'completed' | 'available' | 'locked' | 'due_srs';

export interface CourseProgress {
  lessonStatuses: Map<string, LessonStatus>;
  /** Melhor nota de cada lição concluída (0 a 1). */
  bestScores: Map<string, number>;
  /** Lição disponível agora; com o curso todo concluído, a primeira do curso. */
  nextLesson: string | null;
}

/**
 * Regra de desbloqueio do curso, usada pelo mapa e pela guarda de /licao/:id: as lições concluídas
 * ficam abertas para refazer, a primeira não concluída (na ordem do curso) fica disponível e as
 * demais ficam bloqueadas.
 */
export function lessonStatuses(completed: ReadonlySet<string>): Map<string, LessonStatus> {
  const statuses = new Map<string, LessonStatus>();
  let foundFirst = false;
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      if (completed.has(lesson.id)) {
        statuses.set(lesson.id, 'completed');
      } else if (!foundFirst) {
        statuses.set(lesson.id, 'available');
        foundFirst = true;
      } else {
        statuses.set(lesson.id, 'locked');
      }
    }
  }
  return statuses;
}

/** Lê o progresso salvo e aplica a regra de desbloqueio. */
export async function loadCourseProgress(repo: IdbRepo, userId: string): Promise<CourseProgress> {
  const lessons = course.units.flatMap(u => u.lessons);
  const saved = await Promise.all(
    lessons.map(l => repo.getProgress(userId, l.id) as Promise<Record<string, unknown> | null>),
  );
  const completed = new Set<string>();
  const bestScores = new Map<string, number>();
  lessons.forEach((lesson, i) => {
    const prog = saved[i];
    if (prog?.status === 'completed') {
      completed.add(lesson.id);
      bestScores.set(lesson.id, (prog?.bestScore as number) ?? 0.7);
    }
  });

  const statuses = lessonStatuses(completed);
  const available = [...statuses].find(([, st]) => st === 'available')?.[0];
  const nextLesson = available ?? course.units[0]?.lessons[0]?.id ?? null;
  return { lessonStatuses: statuses, bestScores, nextLesson };
}

/** A lição pode ser aberta agora (concluída ou disponível)? Lição fora do curso conta como bloqueada. */
export function isLessonOpen(progress: CourseProgress, lessonId: string): boolean {
  const status = progress.lessonStatuses.get(lessonId);
  return status !== undefined && status !== 'locked';
}
