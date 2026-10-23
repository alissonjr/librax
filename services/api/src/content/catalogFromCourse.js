import { xpForLesson } from '../domain/xp.js';

/**
 * Catalogo minimo que o servidor precisa para recalcular uma conclusao (SPEC 02 secao 5.2):
 * XP de cada licao, quantos sinais ela ensina (teto do signsLearnedDelta), regras de
 * conquista, ordem dos sinais (fila diaria) e qual licao fecha o alfabeto.
 *
 * Mesma regra do app (apps/web-poc/src/App.tsx): alfabeto completo = ultima licao da U1.
 *
 * @param {object} course course.json do bundle de conteudo
 */
export function catalogFromCourse(course) {
  const units = course.units ?? [];
  const lessons = {};
  for (const unit of units) {
    for (const l of unit.lessons ?? []) {
      lessons[l.id] = { id: l.id, xpReward: xpForLesson(l), signCount: (l.signIds ?? []).length };
    }
  }
  const firstUnitLessons = units[0]?.lessons ?? [];
  return {
    courseId: course.courseId ?? null,
    lessons,
    achievementRules: course.achievementRules ?? [],
    signsOrder: course.signsOrder ?? [],
    alphabetLessonId: firstUnitLessons[firstUnitLessons.length - 1]?.id ?? null,
  };
}
