import signsRaw from '../assets/content/signs.json';
import courseRaw from '../assets/content/course.json';
import { RECOGNIZABLE_LETTERS } from '../components/ExerciseCameraSign';

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

export interface Exercise {
  id: string;
  type: 'intro' | 'sign_camera' | 'mc4' | 'match_pairs' | 'watch_choose_word' | 'order_sequence' | 'mirror_practice' | 'fingerspell' | 'build_phrase';
  signId: string;
  choices?: string[];
  pairSignIds?: string[];
  steps?: string[];
  word?: string;
  letters?: string[];
  /** build_phrase: frase da unidade (glosas na ordem certa + traducao). */
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
  exercises: Exercise[];
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

/**
 * O reconhecedor atual (ExerciseCameraSign) so avalia letras estaticas da lista
 * RECOGNIZABLE_LETTERS. Os demais sinais (numeros, sinais com movimento, letras
 * fora da lista) ainda nao podem receber nota pela camera.
 */
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

export function isCameraEvaluable(sign: Sign | undefined): boolean {
  if (!sign) return false;
  return sign.category === 'alfabeto' && sign.recognition === 'static' && RECOGNIZABLE_LETTERS.has(sign.gloss);
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

/** Exportado para testes. */
export function buildExercises(
  signIds: string[],
  allSignIds: string[],
  localSignsMap: Record<string, Sign> = signsMap,
): Exercise[] {
  const exercises: Exercise[] = [];
  let idx = 0;

  // Fase 1: intro -> pratica com camera -> watch_choose_word -> mc4 para cada sinal
  for (const signId of signIds) {
    exercises.push({ id: `intro-${signId}`, type: 'intro', signId });

    // Camera com nota so para o que o reconhecedor avalia. Para os demais sinais
    // a pratica e livre (mirror_practice), para nao contar erro que o aluno nao cometeu.
    const evaluable = isCameraEvaluable(localSignsMap[signId]);
    if (evaluable) {
      exercises.push({ id: `cam-${signId}`, type: 'sign_camera', signId });
    } else {
      exercises.push({ id: `mirror-${signId}-${idx++}`, type: 'mirror_practice', signId });
    }

    // watch_choose_word: assiste o sinal e escolhe o nome correto
    const wrong1 = pickDistractors(signId, allSignIds, localSignsMap);
    const watchChoices = shuffle([signId, ...wrong1]).map(
      (id) => localSignsMap[id]?.gloss ?? id,
    );
    exercises.push({ id: `watch-${signId}-${idx++}`, type: 'watch_choose_word', signId, choices: watchChoices });

    // mirror_practice: imitar o sinal na camera sem avaliacao automatica
    // (quem nao tem camera avaliada ja recebeu a pratica livre acima)
    if (evaluable) {
      exercises.push({ id: `mirror-${signId}-${idx++}`, type: 'mirror_practice', signId });
    }

    const wrong = pickDistractors(signId, allSignIds, localSignsMap);
    const choices = shuffle([signId, ...wrong]).map(
      (id) => localSignsMap[id]?.gloss ?? id,
    );
    exercises.push({ id: `mc4-${signId}-${idx++}`, type: 'mc4', signId, choices });
  }

  // Fase 2: match_pairs com os primeiros 3 sinais da licao (revisao contextual)
  if (signIds.length >= 3) {
    const pairSignIds = signIds.slice(0, 3);
    exercises.push({
      id: `pairs-${idx++}`,
      type: 'match_pairs',
      signId: pairSignIds[0],
      pairSignIds,
    });
  }

  // Fase 3: rodada de revisao (mc4 + order_sequence quando tiver 3+ sinais)
  for (const signId of signIds) {
    const wrong = pickDistractors(signId, allSignIds, localSignsMap);
    const choices = shuffle([signId, ...wrong]).map(
      (id) => localSignsMap[id]?.gloss ?? id,
    );
    exercises.push({ id: `review-${signId}-${idx++}`, type: 'mc4', signId, choices });
  }

  // order_sequence: organiza os sinais da licao na ordem correta
  if (signIds.length >= 3) {
    const steps = signIds.slice(0, 4).map(id => localSignsMap[id]?.gloss ?? id);
    exercises.push({
      id: `order-${idx++}`,
      type: 'order_sequence',
      signId: signIds[0],
      steps,
    });
  }

  return exercises;
}

/**
 * Soletracao de nomes com letras ja aprendidas (U4). Enquanto o LessonScreen nao
 * renderiza o tipo 'fingerspell', a soletracao entra como order_sequence: o aluno
 * coloca as letras do nome na ordem. `word` e `letters` ja ficam no exercicio para
 * a troca futura pelo ExerciseFingerspell.
 */
export function buildSpellExercises(lessonId: string, words: string[]): Exercise[] {
  return words.map((word, i) => {
    const letters = word.split('');
    return {
      id: `spell-${lessonId}-${i}`,
      type: 'order_sequence',
      signId: `letra-${letters[0]}`,
      steps: letters,
      word,
      letters,
    };
  });
}

/** Primeira unidade (indice 0) com exercicio de montar a frase: U3. */
export const PHRASE_FIRST_UNIT_INDEX = 2;

/** Normaliza a glosa para comparar: caixa alta, sem pontuacao, hifen nem espaco (O-I = OI, B-E-M? = BEM). */
export function normalizeGloss(gloss: string): string {
  return gloss.toUpperCase().replace(/[^\p{L}\p{N}@]/gu, '');
}

/** Formas que contam como glosa ja vista: OBRIGAD@ casa com OBRIGADO e OBRIGADA. */
function glossForms(gloss: string): string[] {
  const g = normalizeGloss(gloss);
  return g.includes('@') ? [g, g.replace(/@/g, 'O'), g.replace(/@/g, 'A')] : [g];
}

/** Quantas glosas da frase ja foram vistas (`seen` guarda glosas normalizadas). */
export function knownGlossCount(phrase: Phrase, seen: Set<string>): number {
  return phrase.glosses.filter((g) => glossForms(g).some((f) => seen.has(f))).length;
}

/**
 * Escolhe a frase da licao entre as da unidade, nesta ordem de preferencia:
 * 1. frases com alguma glosa ja vista ate a licao;
 * 2. frases que ainda nao sairam em outra licao da unidade (`used`, indices), para variar;
 * 3. a maior parte das glosas ja vista; no empate, a ordem do conteudo.
 * Retorna o indice, ou -1 se nao houver frase.
 */
export function pickPhrase(phrases: Phrase[], seen: Set<string>, used: Set<number> = new Set()): number {
  let best = -1;
  let bestKey: number[] = [];
  phrases.forEach((p, i) => {
    if (p.glosses.length < 2) return;
    const known = knownGlossCount(p, seen);
    const key = [known > 0 ? 1 : 0, used.has(i) ? 0 : 1, known / p.glosses.length];
    // Compara criterio a criterio: o primeiro que diferir decide
    const diff = key.findIndex((v, k) => v !== bestKey[k]);
    if (best < 0 || (diff >= 0 && key[diff] > bestKey[diff])) {
      best = i;
      bestKey = key;
    }
  });
  return best;
}

/**
 * Exercicio build_phrase: mostra a traducao e a pessoa monta a frase com os blocos de glosa
 * na ordem da Libras. Junta 1 ou 2 distratores (2 em frases de ate 4 glosas) tirados das
 * glosas das outras frases da mesma unidade, sem repetir nenhuma glosa da frase.
 */
export function buildPhraseExercise(lessonId: string, phrase: Phrase, unitPhrases: Phrase[], signId: string): Exercise {
  const inPhrase = new Set(phrase.glosses.map(normalizeGloss));
  const candidates: string[] = [];
  const seen = new Set(inPhrase);
  for (const p of unitPhrases) {
    for (const g of p.glosses) {
      const n = normalizeGloss(g);
      if (!n || seen.has(n)) continue;
      seen.add(n);
      candidates.push(g);
    }
  }
  const distractors = shuffle(candidates).slice(0, phrase.glosses.length <= 4 ? 2 : 1);

  // Embaralha ate os blocos nao comecarem ja na ordem certa
  let tiles = shuffle([...phrase.glosses, ...distractors]);
  for (let i = 0; i < 5 && phrase.glosses.every((g, j) => tiles[j] === g); i++) {
    tiles = shuffle(tiles);
  }

  return { id: `phrase-${lessonId}`, type: 'build_phrase', signId, phrase, tiles };
}

function buildCourse(): Course {
  const raw = courseRaw as {
    courseId: string;
    title: string;
    signsOrder: string[];
    achievementRules: AchievementRule[];
    units: Array<{
      id: string;
      title: string;
      description: string;
      phrases?: Phrase[];
      cultureNotes?: CultureNote[];
      lessons: Array<{
        id: string;
        title: string;
        order: number;
        xpReward: number;
        signIds: string[];
        spellWords?: string[];
      }>;
    }>;
  };

  const allSignIds = raw.signsOrder;
  const lessonsMap: Record<string, Lesson> = {};
  // Glosas (normalizadas) ja apresentadas ate a licao atual, na ordem do curso
  const seenGlosses = new Set<string>();
  const usedPhrases = new Map<string, Set<number>>();

  const units: Unit[] = raw.units.map((u, unitIdx) => ({
    ...u,
    lessons: u.lessons.map(({ spellWords, ...l }) => {
      const exercises = buildExercises(l.signIds, allSignIds);
      if (spellWords?.length) exercises.push(...buildSpellExercises(l.id, spellWords));
      for (const id of l.signIds) seenGlosses.add(normalizeGloss(signsMap[id]?.gloss ?? ''));
      if (unitIdx >= PHRASE_FIRST_UNIT_INDEX && u.phrases?.length) {
        const used = usedPhrases.get(u.id) ?? new Set<number>();
        usedPhrases.set(u.id, used);
        const pick = pickPhrase(u.phrases, seenGlosses, used);
        if (pick >= 0) {
          used.add(pick);
          exercises.push(buildPhraseExercise(l.id, u.phrases[pick], u.phrases, l.signIds[0] ?? ''));
        }
      }
      const lesson: Lesson = { ...l, exercises };
      lessonsMap[l.id] = lesson;
      return lesson;
    }),
  }));

  return { courseId: raw.courseId, title: raw.title, signsOrder: raw.signsOrder, achievementRules: raw.achievementRules, units, lessonsMap };
}

export const course = buildCourse();

export function getSign(id: string): Sign {
  const s = signsMap[id];
  if (!s) throw new Error(`Sinal nao encontrado: ${id}`);
  return s;
}
