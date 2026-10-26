import signsRaw from '../assets/content/signs.json';
import { course, type Phrase, type SourceRef } from './course';
import { getClassifier, loadClassifier } from '../recognition/classifier';
import { getSignGlosses, loadSignIndex } from '../recognition/signModel';
import { getMotionLetters, loadLetterMotionIndex } from '../recognition/letterMotionModel';
import { getCameraNumbers, loadNumberIndex } from '../recognition/numberModel';
import { getDisplayName } from './auth';
import { ownNameLetters, type SpellReader } from './fingerspell';

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
  | BundleBase<'fingerspell', {
      word: string;
      letters: string[];
      per_letter_confidence: number | null;
      /** "Soletre seu nome": o app troca a palavra pelo nome do perfil; `word` é a reserva. */
      own_name?: boolean;
      /** Número feito dígito a dígito ("faça 20": 2 e depois 0); `letters` são os dígitos. */
      numbers?: boolean;
    }>
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
  /** fingerspell e order_sequence de soletração: a palavra é o nome do perfil. */
  ownName?: boolean;
  /** fingerspell: quem lê cada letra (ou dígito) da palavra (spellReadersFor). */
  spellReaders?: SpellReader[];
  /** fingerspell e order_sequence de soletração: é um número feito dígito a dígito. */
  spellNumbers?: boolean;
  /** word_choose_video: os sinais das 4 demonstrações, em ordem sorteada (`signId` é o certo). */
  videoOptions?: string[];
  /** build_phrase: frase da unidade (glosas na ordem certa + tradução). */
  phrase?: Phrase;
  /** build_phrase: blocos embaralhados (glosas da frase + distratores). */
  tiles?: string[];
  /**
   * perform_sign: 'sinais' quando quem avalia é o modelo dos sinais com movimento (mãos e corpo,
   * ExerciseCameraMotionSign); 'letras-mov' quando é o das letras com movimento (só as mãos,
   * ExerciseCameraMotionLetter); 'numeros' quando é o modelo dos números de 0 a 9 (mão parada,
   * ExerciseCameraSign com o classificador dos números); ausente nas letras paradas (ExerciseCameraSign).
   */
  recognizer?: 'sinais' | 'letras-mov' | 'numeros';
}

// Os tipos e o curso continuam saindo daqui para quem já importa de content.ts
export { course };
export type { Lesson, SourceRef, Phrase, CultureNote, Unit, AchievementRule, Course } from './course';

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
  return text.replace(glossRegex(gloss.toLowerCase(), 'giu'), '___');
}

/** Glosa como palavra inteira (composta aceita hífen ou espaço entre as partes). */
function glossRegex(gloss: string, flags: string): RegExp {
  const words = gloss
    .split('-')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s-]+');
  return new RegExp(`(?<![\\p{L}\\p{N}])${words}(?![\\p{L}\\p{N}])`, flags);
}

/**
 * Descrição mostrada num exercício de escolha antes da resposta. Esconde a glosa certa (como o
 * maskGloss) e também as glosas das outras opções citadas na descrição, como "(HOMEM)" na de PAI
 * ou "como no sinal FILHO" na de FILHA, que dariam pista de qual opção é qual. A citação de outro
 * sinal vem em maiúsculas, como glosa; a mesma palavra em minúsculas é texto comum ("como quem
 * pega") e fica, para a descrição continuar legível.
 */
export function maskChoiceCaption(text: string, answer: string, options: string[]): string {
  let out = maskGloss(text, answer);
  // As mais longas primeiro: MEIO-DIA sai inteira antes de DIA
  const others = [...new Set(options)]
    .filter((g) => g !== answer && g.length >= 2)
    .sort((a, b) => b.length - a.length);
  for (const gloss of others) out = out.replace(glossRegex(gloss, 'gu'), '___');
  return out;
}

/**
 * A camera so avalia letras estaticas que o classificador em uso conhece: as do MLP treinado
 * quando /ml/classifier/model.json existe, senao as do heuristico (src/recognition/classifier.ts).
 * Numeros (isNumberEvaluable), sinais e letras com movimento tem os modelos proprios; letras fora
 * da lista nao recebem nota pela camera.
 */
export function isCameraEvaluable(sign: Sign | undefined): boolean {
  if (!sign) return false;
  return sign.category === 'alfabeto' && sign.recognition === 'static' && getClassifier().letters.has(sign.gloss);
}

/**
 * Sinal com movimento que a câmera avalia: a glosa está nos rótulos do modelo de sinais
 * (/ml/sinais/model.json, lido pelo loadSignIndex antes de resolver a lição). Sem modelo, nenhum.
 */
export function isMotionSignEvaluable(sign: Sign | undefined): boolean {
  return !!sign && getSignGlosses().has(sign.gloss);
}

/** Lê o model.json dos sinais uma vez por sessão; a rota da lição espera antes de resolver. */
export { loadSignIndex };

/**
 * Letra com movimento (H, J, K, X, Z, Ç) que a câmera avalia COM o movimento: está nos rótulos do
 * modelo das letras com movimento (/ml/letras-mov/model.json, lido pelo loadLetterMotionIndex antes
 * de resolver a lição). Vale antes do modelo das letras paradas, que só vê a forma da mão. Sem
 * modelo, nenhuma: H e K seguem com o modelo das letras paradas e J, Z e Ç com a prática livre.
 */
export function isLetterMotionEvaluable(sign: Sign | undefined): boolean {
  return !!sign && sign.category === 'alfabeto' && getMotionLetters().has(sign.gloss);
}

/** Lê o model.json das letras com movimento uma vez por sessão; a rota da lição espera antes de resolver. */
export { loadLetterMotionIndex };

/**
 * Número de 0 a 9 que a câmera avalia: está em camera_numbers do modelo dos números
 * (/ml/numeros/model.json, lido pelo loadNumberIndex antes de resolver a lição), os que passaram no
 * teste com pessoas nunca vistas. Sem modelo, nenhum: os números seguem como prática livre.
 */
export function isNumberEvaluable(sign: Sign | undefined): boolean {
  return !!sign && sign.category === 'numeros' && getCameraNumbers().has(sign.gloss);
}

/** Lê o model.json dos números uma vez por sessão; a rota da lição espera antes de resolver. */
export { loadNumberIndex };

/**
 * Carrega o classificador das letras paradas (o MLP, quando publicado) uma vez por sessão: a rota da
 * lição espera, para isCameraEvaluable e a soletração verem as letras dele e não só as do heurístico.
 */
export { loadClassifier };

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
  /** Se o modelo dos sinais com movimento avalia o sinal (padrao: isMotionSignEvaluable). */
  canEvaluateMotion?: (sign: Sign | undefined) => boolean;
  /** Se o modelo das letras com movimento avalia a letra (padrao: isLetterMotionEvaluable). */
  canEvaluateLetterMotion?: (sign: Sign | undefined) => boolean;
  /** Se o modelo dos números avalia o número (padrao: isNumberEvaluable). */
  canEvaluateNumber?: (sign: Sign | undefined) => boolean;
  /** Nome do perfil para o "soletre seu nome" (padrao: o salvo no aparelho pelo onboarding). */
  displayName?: string | null;
}

/**
 * Transforma os exercicios do bundle no que a tela mostra, com os sorteios da sessao:
 * - watch_choose_word sem `options` ganha 3 distratores (mesma categoria primeiro) e ordem sorteada;
 * - build_phrase sorteia os distratores e a ordem dos blocos;
 * - word_choose_video sorteia a ordem das 4 demonstracoes;
 * - perform_sign de letra com movimento que o modelo das letras com movimento conhece fica com ele
 *   (recognizer 'letras-mov'); de letra avaliada, com o classificador das letras paradas; de sinal
 *   que o modelo de sinais com movimento conhece, com ele (recognizer 'sinais'); de numero de 0 a 9 que
 *   o modelo dos numeros avalia, com ele (recognizer 'numeros'); senao vira mirror_practice
 *   (pratica livre, sem nota, para nao contar erro que a pessoa nao cometeu) e a pratica livre
 *   repetida do mesmo sinal sai;
 * - fingerspell ganha o leitor de cada letra (spellReadersFor): letras paradas com o classificador
 *   delas, letras com movimento com o modelo das letras com movimento, digitos com o dos numeros e,
 *   sem camera para a letra com movimento (o Z) ou para o digito, pratica livre dentro da palavra.
 *   Letra parada que a camera nao avalia, ou palavra sem nenhum passo avaliado, vira
 *   order_sequence com as letras (a pessoa poe as letras na ordem). No "soletre seu nome"
 *   (`own_name`), a palavra e o primeiro nome do perfil (ownNameLetters); se o nome nao da, fica a
 *   palavra de reserva do bundle, como um fingerspell comum.
 * `lessonSignIds[0]` e o sinal de referencia dos exercicios que nao tem um sinal so.
 */
export function resolveExercises(items: BundleExercise[], lessonSignIds: string[], opts: ResolveOptions = {}): Exercise[] {
  const map = opts.signsMap ?? signsMap;
  const pool = opts.allSignIds ?? course.signsOrder;
  const canEvaluate = opts.canEvaluate ?? isCameraEvaluable;
  const canEvaluateMotion = opts.canEvaluateMotion ?? isMotionSignEvaluable;
  const canEvaluateLetterMotion = opts.canEvaluateLetterMotion ?? isLetterMotionEvaluable;
  const canEvaluateNumber = opts.canEvaluateNumber ?? isNumberEvaluable;
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
        if (canEvaluateLetterMotion(map[signId])) {
          out.push({ id, type: 'perform_sign', signId, recognizer: 'letras-mov' });
        } else if (canEvaluate(map[signId])) {
          out.push({ id, type: 'perform_sign', signId });
        } else if (canEvaluateMotion(map[signId])) {
          out.push({ id, type: 'perform_sign', signId, recognizer: 'sinais' });
        } else if (canEvaluateNumber(map[signId])) {
          out.push({ id, type: 'perform_sign', signId, recognizer: 'numeros' });
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
        const { per_letter_confidence } = item.payload;
        const name = item.payload.own_name
          ? ownNameLetters(opts.displayName !== undefined ? opts.displayName : getDisplayName())
          : null;
        const letters = name ?? item.payload.letters;
        const word = name ? name.join('') : item.payload.word;
        const own = name ? { ownName: true } : {};
        const numbers = !!item.payload.numbers;
        const kind = numbers ? { spellNumbers: true } : {};
        const signId = `${numbers ? 'numero' : 'letra'}-${letters[0]}`;
        const readers = spellReadersFor(letters, numbers, {
          signsMap: map, canEvaluate, canEvaluateLetterMotion, canEvaluateNumber,
        });
        if (readers) {
          out.push({
            id, type: 'fingerspell', signId, word, letters, perLetterConfidence: per_letter_confidence,
            spellReaders: readers, ...own, ...kind,
          });
        } else {
          out.push({ id, type: 'order_sequence', signId, steps: letters, correctOrder: letters.map((_, i) => i), word, ...own, ...kind });
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

/**
 * Quem lê cada passo de uma soletração, ou null quando a câmera não serve (vira order_sequence).
 * - Letra: o modelo das letras com movimento quando ele a avalia (H, J, K, X e Ç, como no
 *   perform_sign); senão o classificador das letras paradas; senão, se é letra com movimento
 *   (recognition dynamic, o Z), prática livre. Letra parada que a câmera não avalia: null.
 * - Dígito: o modelo dos números quando ele o avalia (camera_numbers); senão prática livre.
 * Sem nenhum passo avaliado (todos livres): null.
 */
export function spellReadersFor(
  letters: readonly string[],
  numbers: boolean,
  opts: Pick<ResolveOptions, 'signsMap' | 'canEvaluate' | 'canEvaluateLetterMotion' | 'canEvaluateNumber'> = {},
): SpellReader[] | null {
  const map = opts.signsMap ?? signsMap;
  const canEvaluate = opts.canEvaluate ?? isCameraEvaluable;
  const canEvaluateLetterMotion = opts.canEvaluateLetterMotion ?? isLetterMotionEvaluable;
  const canEvaluateNumber = opts.canEvaluateNumber ?? isNumberEvaluable;
  const readers: SpellReader[] = [];
  for (const l of letters) {
    if (numbers) {
      readers.push(canEvaluateNumber(map[`numero-${l}`]) ? 'numeros' : 'livre');
      continue;
    }
    const sign = map[`letra-${l}`];
    if (canEvaluateLetterMotion(sign)) readers.push('letras-mov');
    else if (canEvaluate(sign)) readers.push('letras');
    else if (sign?.recognition === 'dynamic') readers.push('livre');
    else return null;
  }
  return readers.some((r) => r !== 'livre') ? readers : null;
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
  const [items] = await Promise.all([
    loadLessonBundle(lessonId), loadSignIndex(), loadLetterMotionIndex(), loadNumberIndex(), loadClassifier(),
  ]);
  return items ? resolveExercises(items, lesson.signIds) : null;
}


export function getSign(id: string): Sign {
  const s = signsMap[id];
  if (!s) throw new Error(`Sinal nao encontrado: ${id}`);
  return s;
}
