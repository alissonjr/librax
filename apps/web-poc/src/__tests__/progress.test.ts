import { describe, it, expect } from 'vitest';
import { course } from '../lib/course';
import { isLessonOpen, lessonStatuses, type CourseProgress } from '../lib/progress';

const ids = course.units.flatMap(u => u.lessons.map(l => l.id));
const progress = (completed: string[]): CourseProgress => ({
  lessonStatuses: lessonStatuses(new Set(completed)),
  bestScores: new Map(),
  nextLesson: null,
});

describe('regra de desbloqueio (mapa e guarda de /licao/:id)', () => {
  it('sem progresso, só a primeira lição do curso abre', () => {
    const p = progress([]);
    expect(p.lessonStatuses.get(ids[0])).toBe('available');
    expect(ids.slice(1).every(id => p.lessonStatuses.get(id) === 'locked')).toBe(true);
    expect(isLessonOpen(p, ids[0])).toBe(true);
    expect(isLessonOpen(p, ids[1])).toBe(false);
  });

  it('concluídas continuam abertas e a primeira não concluída fica disponível', () => {
    const p = progress([ids[0], ids[1]]);
    expect(p.lessonStatuses.get(ids[0])).toBe('completed');
    expect(p.lessonStatuses.get(ids[2])).toBe('available');
    expect(isLessonOpen(p, ids[0])).toBe(true);
    expect(isLessonOpen(p, ids[2])).toBe(true);
    expect(isLessonOpen(p, ids[3])).toBe(false);
  });

  it('lição fora do curso não abre', () => {
    expect(isLessonOpen(progress([]), 'u99-l1')).toBe(false);
  });
});
