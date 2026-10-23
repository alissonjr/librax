import courseRaw from '../assets/content/course.json';

/**
 * Estrutura do curso (unidades e lições), sem os sinais. Fica no pedaço principal do app porque o
 * mapa, o perfil e a guarda de lição precisam dele; os sinais (signs.json, cerca de 330 KB) ficam em
 * content.ts, que só as telas de lição e de prática carregam.
 */

export interface Lesson {
  id: string;
  title: string;
  order: number;
  xpReward: number;
  signIds: string[];
  /** Nomes soletrados na lição (U4); viram fingerspell no bundle. */
  spellWords?: string[];
}

export interface SourceRef {
  name: string;
  url: string;
}

/** Frase de exemplo (rascunho): glosas na ordem da Libras + traducao. Usada no exercicio build_phrase. */
export interface Phrase {
  glosses: string[];
  pt: string;
  source: SourceRef;
}

export interface CultureNote {
  title: string;
  text: string;
  source: SourceRef;
}

export interface Unit {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  phrases?: Phrase[];
  cultureNotes?: CultureNote[];
}

export interface AchievementRule {
  code: string;
  type: string;
  gte?: number;
}

export interface Course {
  courseId: string;
  title: string;
  signsOrder: string[];
  achievementRules: AchievementRule[];
  units: Unit[];
  lessonsMap: Record<string, Lesson>;
}

function buildCourse(): Course {
  const raw = courseRaw as Omit<Course, 'lessonsMap'>;
  const lessonsMap: Record<string, Lesson> = {};
  for (const unit of raw.units) {
    for (const lesson of unit.lessons) lessonsMap[lesson.id] = lesson;
  }
  return { ...raw, lessonsMap };
}

export const course = buildCourse();
