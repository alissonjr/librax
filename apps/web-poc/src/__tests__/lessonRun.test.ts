import { describe, it, expect, beforeEach } from 'vitest';
import {
  LESSON_RUN_MAX_AGE_MS,
  clearLessonRun,
  contentVersion,
  latestLessonRun,
  loadLessonRun,
  saveLessonRun,
} from '../lib/lessonRun';
import type { Exercise } from '../lib/content';

const EXERCISES: Exercise[] = [
  { id: 'e1', type: 'sign_intro', signId: 'letra-A' },
  { id: 'e2', type: 'watch_choose_word', signId: 'letra-A', choices: ['E', 'A', 'B', 'C'] },
];
const T0 = 1_800_000_000_000;

function save(lessonId: string, version: string, now = T0, index = 1) {
  saveLessonRun('u1', { lessonId, version, exercises: EXERCISES, index, correct: 0, attempted: 0, reviewed: [], seen: ['letra-A'] }, now);
}

beforeEach(() => localStorage.clear());

describe('lessonRun', () => {
  it('guarda e devolve os exercícios sorteados e o ponto da lição', () => {
    save('u1-l1', 'v1');
    const run = loadLessonRun('u1', 'u1-l1', 'v1', T0 + 1000);
    expect(run?.index).toBe(1);
    expect(run?.exercises[1].choices).toEqual(['E', 'A', 'B', 'C']);
    expect(run?.seen).toEqual(['letra-A']);
  });

  it('descarta e apaga a lição salva há 12 horas ou mais', () => {
    save('u1-l1', 'v1');
    expect(loadLessonRun('u1', 'u1-l1', 'v1', T0 + LESSON_RUN_MAX_AGE_MS)).toBeNull();
    expect(loadLessonRun('u1', 'u1-l1', 'v1', T0)).toBeNull();
  });

  it('descarta e apaga a lição salva com outra versão do conteúdo', () => {
    save('u1-l1', 'v1');
    expect(loadLessonRun('u1', 'u1-l1', 'v2', T0)).toBeNull();
    expect(loadLessonRun('u1', 'u1-l1', 'v1', T0)).toBeNull();
  });

  it('é por pessoa e por lição, e clear apaga', () => {
    save('u1-l1', 'v1');
    expect(loadLessonRun('outra', 'u1-l1', 'v1', T0)).toBeNull();
    clearLessonRun('u1', 'u1-l1');
    expect(loadLessonRun('u1', 'u1-l1', 'v1', T0)).toBeNull();
  });

  it('latestLessonRun acha a lição em andamento mais recente (faixa Retomar)', () => {
    save('u1-l1', 'v1', T0);
    save('u1-l2', 'v1', T0 + 5000);
    expect(latestLessonRun('u1', T0 + 6000)?.lessonId).toBe('u1-l2');
    expect(latestLessonRun('u1', T0 + LESSON_RUN_MAX_AGE_MS + 6000)).toBeNull();
  });

  it('contentVersion muda quando o bundle muda', () => {
    expect(contentVersion([{ a: 1 }])).toBe(contentVersion([{ a: 1 }]));
    expect(contentVersion([{ a: 1 }])).not.toBe(contentVersion([{ a: 2 }]));
  });
});
