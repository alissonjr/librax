import signsRaw from '../assets/content/signs.json';
import courseRaw from '../assets/content/course.json';
import { getClassifier } from '../recognition/classifier';

export interface Sign {
  id: string;
  gloss: string;
  category: string;
  recognition: string;
  params: { CM: string; PA: string; MOV: string; OR: string; ENM: string };
  video_url: string | null;
  video_caption: string;
  /** Demonstracao por avatar enquanto nao ha video com pessoa real (ver SignAvatar). */
  avatar?: SignAvatar | null;
  /** De onde veio a descricao (rascunho ate a validacao pela comunidade surda). */
  source?: { name: string; url: string };
  status?: string;
  validated?: boolean;
  notes?: string;
}

/**
 * Glosa do VLibras que o avatar toca para o sinal. `gloss` null quando nao ha
 * correspondencia; `sequence` quando o composto vira mais de uma glosa (separadas
 * por espaco, o player toca uma depois da outra). `notes` registra divergencia de
 * variante entre o avatar e a descricao da licao.
 */
export interface SignAvatar {
  provider: 'vlibras';
  gloss: string | null;
  sequence?: boolean;
  notes?: string;
}

/**
 * Tipos de exercício do bundle (spec-03 seção 3). `sign_intro` é o passo "apresenta" da regra de
 * composição; `watch_choose_word` absorveu o antigo mc4; `perform_sign` é a câmera avaliada.
 */
export type ExerciseType =
  | 'sign_intro'
  | 'perform_sign'
  | 'watch_choose_word'
  | 'word_choose_video'
  | 'match_pairs'
  | 'order_sequence'
  | 'build_phrase'
  | 'fingerspell'
  | 'mirror_practice';

interface BundleBase<T extends ExerciseType, P> {
  id: string;
  lesson_id: string;
  type: T;
  order: number;
  payload: P;
}

/** Exercício como vem do bundle (src/assets/content/lessons, gerado por tools/content/build-lessons.mjs). */
export type BundleExercise =
  | BundleBase<'sign_intro', { sign_id: string }>
  | BundleBase<'perform_sign', {
      sign_id: string;
      recognition: 'static' | 'dynamic';
      min_confidence: number | null;
      max_attempts: number | null;
      hint_video_url: string | null;
    }>
  | BundleBase<'watch_choose_word', { sign_id: string; correct: string; options?: string[] }>
  | BundleBase<'word_choose_video', { word: string; video_options: string[]; correct_sign_id: string }>
  | BundleBase<'match_pairs', { pairs: { sign_id: string; gloss: string }[] }>
  | BundleBase<'order_sequence', { steps: string[]; correct_order: number[]; word?: string }>
  | BundleBase<'build_phrase', { pt: string; glosses: string[]; distractors: string[]; source: SourceRef }>
  | BundleBase<'fingerspell', { word: string; letters: string[]; per_letter_confidence: number | null }>
  | BundleBase<'mirror_practice', { sign_id: string }>;

/** Tipos que o LessonScreen renderiza hoje. */
export type RenderedExerciseType =
  | 'sign_intro'
  | 'perform_sign'
  | 'watch_choose_word'
  | 'word_choose_video'
  | 'match_pairs'
  | 'order_sequence'
  | 'build_phrase'
  | 'fingerspell'
  | 'mirror_practice';

/** Exercício pronto para a tela: o do bundle com os sorteios da sessão já feitos. */
export interface Exercise {
  id: string;
  type: RenderedExerciseType;
  signId: string;
  choices?: string[];
  pairSignIds?: string[];
  steps?: string[];
  correctOrder?: number[];
  /** order_sequence de soletração e fingerspell: a palavra soletrada. */
  word?: string;
  /** fingerspell: as letras da palavra, na ordem. */
  letters?: string[];
  /** fingerspell: confiança mínima por letra (null = padrão do reconhecedor). */
  perLetterConfidence?: number | null;
  /** word_choose_video: os sinais das 4 demonstrações, em ordem sorteada (`signId` é o certo). */
  videoOptions?: string[];
  /** build_phrase: frase da unidade (glosas na ordem certa + tradução). */
  phrase?: Phrase;
  /** build_phrase: blocos embaralhados (glosas da frase + distratores). */
  tiles?: string[];
}

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

export const signsMap: Record<string, Sign> = {};
for (const s of signsRaw as Sign[]) signsMap[s.id] = s;

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Esconde a glosa dentro da descricao do sinal (ex.: "descascasse uma banana" em BANANA), para nao entregar a resposta. */
export function maskGloss(text: string, gloss: string): string {
  if (gloss.length < 2) return text;
  const words = gloss
    .toLowerCase()
    .split('-')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s-]+');
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, 'giu'), '___');
}

/**
 * A camera so avalia letras estaticas que o classificador em uso conhece: as do MLP treinado
 * quando /ml/classifier/model.json existe, senao as do heuristico (src/recognition/classifier.ts).
 * Os demais sinais (numeros, sinais com movimento, letras fora da lista) ainda nao podem
 * receber nota pela camera.
 */
export function isCameraEvaluable(sign: Sign | undefined): boolean {
  if (!sign) return false;
  return sign.category === 'alfabeto' && sign.recognition === 'static' && getClassifier().letters.has(sign.gloss);
}

/**
 * Escolhe 3 distratores para as questoes de multipla escolha. Prefere sinais da
 * mesma categoria (letras com letras, numeros com numeros) e completa com o
 * restante se a categoria tiver poucos sinais. Nunca repete glosa.
 */
function pickDistractors(signId: string, allSignIds: string[], localSignsMap: Record<string, Sign>): string[] {
  const category = localSignsMap[signId]?.category;
  const gloss = (id: string) => localSignsMap[id]?.gloss ?? id;
  const others = allSignIds.filter((s) => s !== signId);
  const sameCategory = shuffle(others.filter((s) => localSignsMap[s]?.category === category));
  const rest = shuffle(others.filter((s) => localSignsMap[s]?.category !== category));
  const picked: string[] = [];
  const seen = new Set([gloss(signId)]);
  for (const id of [...sameCategory, ...rest]) {
    if (picked.length === 3) break;
    if (seen.has(gloss(id))) continue;
    seen.add(gloss(id));
    picked.push(id);
  }
  return picked;
}


/** Opções de watch_choose_word: a resposta e 3 distratores, em ordem sorteada. */
export function drawChoices(signId: string, allSignIds: string[], localSignsMap: Record<string, Sign> = signsMap): string[] {
  return shuffle([signId, ...pickDistractors(signId, allSignIds, localSignsMap)]).map(
    (id) => localSignsMap[id]?.gloss ?? id,
  );
}

/**
 * Blocos do build_phrase: a frase inteira mais 1 ou 2 distratores (2 em frases de até 4 glosas)
 * sorteados entre os candidatos do bundle, embaralhados até não começarem já na ordem certa.
 */
export function phraseTiles(glosses: string[], distractors: string[]): string[] {
  const picked = shuffle(distractors).slice(0, glosses.length <= 4 ? 2 : 1);
  let tiles = shuffle([...glosses, ...picked]);
  for (let i = 0; i < 5 && glosses.every((g, j) => tiles[j] === g); i++) {
    tiles = shuffle(tiles);
  }
  return tiles;
}

export interface ResolveOptions {
  /** Sinais de onde saem os distratores (padrao: todos os do curso). */
  allSignIds?: string[];
  signsMap?: Record<string, Sign>;
  /** Se a camera deste aparelho avalia o sinal (padrao: isCameraEvaluable). */
  canEvaluate?: (sign: Sign | undefined) => boolean;
}

/**
 * Transforma os exercicios do bundle no que a tela mostra, com os sorteios da sessao:
 * - watch_choose_word sem `options` ganha 3 distratores (mesma categoria primeiro) e ordem sorteada;
 * - build_phrase sorteia os distratores e a ordem dos blocos;
 * - word_choose_video sorteia a ordem das 4 demonstracoes;
 * - perform_sign de sinal que a camera nao avalia vira mirror_practice (pratica livre, sem nota,
 *   para nao contar erro que a pessoa nao cometeu) e a pratica livre repetida do mesmo sinal sai;
 * - fingerspell so usa a camera quando ela avalia todas as letras da palavra; senao vira
 *   order_sequence com as letras (a pessoa poe as letras na ordem).
 * `lessonSignIds[0]` e o sinal de referencia dos exercicios que nao tem um sinal so.
 */
export function resolveExercises(items: BundleExercise[], lessonSignIds: string[], opts: ResolveOptions = {}): Exercise[] {
  const map = opts.signsMap ?? signsMap;
  const pool = opts.allSignIds ?? course.signsOrder;
  const canEvaluate = opts.canEvaluate ?? isCameraEvaluable;
  const firstSign = lessonSignIds[0] ?? '';
  const mirrored = new Set<string>();
  const out: Exercise[] = [];

  for (const item of [...items].sort((a, b) => a.order - b.order)) {
    const { id } = item;
    switch (item.type) {
      case 'sign_intro':
        out.push({ id, type: 'sign_intro', signId: item.payload.sign_id });
        break;
      case 'perform_sign': {
        const signId = item.payload.sign_id;
        if (canEvaluate(map[signId])) {
          out.push({ id, type: 'perform_sign', signId });
        } else {
          mirrored.add(signId);
          out.push({ id, type: 'mirror_practice', signId });
        }
        break;
      }
      case 'mirror_practice': {
        const signId = item.payload.sign_id;
        if (mirrored.has(signId)) break;
        mirrored.add(signId);
        out.push({ id, type: 'mirror_practice', signId });
        break;
      }
      case 'watch_choose_word': {
        const signId = item.payload.sign_id;
        const choices = item.payload.options?.length
          ? shuffle(item.payload.options)
          : drawChoices(signId, pool, map);
        out.push({ id, type: 'watch_choose_word', signId, choices });
        break;
      }
      case 'match_pairs': {
        const pairSignIds = item.payload.pairs.map((p) => p.sign_id);
        out.push({ id, type: 'match_pairs', signId: pairSignIds[0] ?? firstSign, pairSignIds });
        break;
      }
      case 'order_sequence': {
        const { steps, correct_order, word } = item.payload;
        const signId = word ? `letra-${steps[0]}` : firstSign;
        out.push({ id, type: 'order_sequence', signId, steps, correctOrder: correct_order, word });
        break;
      }
      case 'fingerspell': {
        const { word, letters, per_letter_confidence } = item.payload;
        const signId = `letra-${letters[0]}`;
        if (letters.every((l) => canEvaluate(map[`letra-${l}`]))) {
          out.push({ id, type: 'fingerspell', signId, word, letters, perLetterConfidence: per_letter_confidence });
        } else {
          out.push({ id, type: 'order_sequence', signId, steps: letters, correctOrder: letters.map((_, i) => i), word });
        }
        break;
      }
      case 'build_phrase': {
        const { pt, glosses, source, distractors } = item.payload;
        out.push({ id, type: 'build_phrase', signId: firstSign, phrase: { pt, glosses, source }, tiles: phraseTiles(glosses, distractors) });
        break;
      }
      case 'word_choose_video': {
        const { correct_sign_id, video_options } = item.payload;
        out.push({ id, type: 'word_choose_video', signId: correct_sign_id, videoOptions: shuffle(video_options) });
        break;
      }
    }
  }
  return out;
}

interface LessonFile {
  lesson_id: string;
  exercises: BundleExercise[];
}

// Um arquivo por licao, carregado so quando a licao abre (cada um vira um pedaco do build e entra no precache)
const LESSON_FILES = import.meta.glob<LessonFile>('../assets/content/lessons/*.json', { import: 'default' });

/** Exercicios da licao como estao no bundle, ou null se a licao nao tem arquivo. */
export async function loadLessonBundle(lessonId: string): Promise<BundleExercise[] | null> {
  const load = LESSON_FILES[`../assets/content/lessons/${lessonId}.json`];
  if (!load) return null;
  const file = await load();
  return file.exercises;
}

/** Exercicios da licao prontos para a tela (sorteios desta sessao ja feitos), ou null se a licao nao existe. */
export async function loadLessonExercises(lessonId: string): Promise<Exercise[] | null> {
  const lesson = course.lessonsMap[lessonId];
  if (!lesson) return null;
  const items = await loadLessonBundle(lessonId);
  return items ? resolveExercises(items, lesson.signIds) : null;
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

export function getSign(id: string): Sign {
  const s = signsMap[id];
  if (!s) throw new Error(`Sinal nao encontrado: ${id}`);
  return s;
}
