import { xpForLesson } from '../domain/xp.js';

/**
 * Catalogo minimo que o servidor precisa para recalcular uma conclusao (SPEC 02 secao 5.2):
 * XP de cada licao, quantos sinais ela ensina (teto do signsLearnedDelta), regras de
 * conquista, ordem dos sinais (fila diaria), qual licao fecha o alfabeto e a glosa de cada sinal
 * do curso (rotulos aceitos no desempenho da camera, lessonCompletion.parseCameraStats).
 *
 * Mesma regra do app (apps/web-poc/src/App.tsx): alfabeto completo = ultima licao da U1.
 * O teste de nivelamento (apps/web-poc/src/lib/placement.ts, placementLessons) cobre a U1 (alfabeto)
 * e a U2 (numeros): so licoes dessas duas podem chegar marcadas como puladas (`placementLessonIds`).
 *
 * @param {object} course course.json do bundle de conteudo
 * @param {object[]} [signs] signs.json do bundle (id e glosa de cada sinal)
 */
export function catalogFromCourse(course, signs = []) {
  const units = course.units ?? [];
  const lessons = {};
  for (const unit of units) {
    for (const l of unit.lessons ?? []) {
      lessons[l.id] = { id: l.id, xpReward: xpForLesson(l), signCount: (l.signIds ?? []).length };
    }
  }
  const firstUnitLessons = units[0]?.lessons ?? [];
  const signsOrder = course.signsOrder ?? [];
  const inCourse = new Set(signsOrder);
  const signGlosses = {};
  for (const s of signs) {
    if (inCourse.has(s.id) && typeof s.gloss === 'string') signGlosses[s.id] = s.gloss;
  }
  return {
    courseId: course.courseId ?? null,
    lessons,
    achievementRules: course.achievementRules ?? [],
    signsOrder,
    alphabetLessonId: firstUnitLessons[firstUnitLessons.length - 1]?.id ?? null,
    placementLessonIds: units.slice(0, 2).flatMap((u) => (u.lessons ?? []).map((l) => l.id)),
    signGlosses,
  };
}
