import { course, type Lesson } from './course';
import type { IdbRepo } from './idbRepo';
import { enqueuePlacementMarks, flushOutbox, type PlacementMark } from './sync';
import { getToday } from './today';

/**
 * Teste de nivelamento (spec-03 seções 7 e 11.11): um convite, nunca obrigatório.
 *
 * Quem já sabe o alfabeto manual (e, se quiser, os números) mostra algumas letras na câmera e pula
 * as lições que já domina. Regras:
 * - Amostra: até 2 sinais por lição ainda não concluída da unidade 1 (e da 2, se a pessoa pedir os
 *   números), com uma letra com movimento quando o modelo da câmera conhece alguma da lição. Sinal
 *   que a câmera deste aparelho não avalia vira "qual é esta letra?" com a mão em 3D.
 * - Uma lição fica dominada quando todos os seus itens saem certos. Errar ou pular o primeiro item
 *   já tira a lição do teste (o segundo nem aparece), para quem está começando terminar logo.
 * - Só reconhecer não prova que a pessoa faz a letra: lição sem nenhum acerto pela câmera só pode
 *   ser pulada entre as NO_CAMERA_MAX_LESSONS primeiras do curso. Sem câmera (negada, com erro ou
 *   por escolha), o teste fica nelas.
 * - Pular é só abrir caminho: a lição é gravada como concluída com `placement: true`, sem XP, sem
 *   sequência, sem SRS e sem conquista. A lição pulada continua aberta para refazer; refeita, vira
 *   uma conclusão normal (o registro é substituído).
 * - Lições de revisão (sem sinal novo, como "letras parecidas") não têm itens: são puladas junto
 *   só quando todas as lições de onde vêm os sinais delas foram puladas no teste ou já concluídas.
 * - "Alfabeto completo" segue a regra do servidor: concluir de verdade a última lição da U1
 *   (alphabetLessonId). O teste nunca dá a conquista; se ela foi pulada, vem ao refazê-la.
 * - Desfazer (Configurações) apaga os registros com `placement` e o convite volta.
 *
 * O servidor fica sabendo pela fila de envio (sync.ts, enqueuePlacementMarks): cada lição pulada
 * vira uma marca `skip` e cada lição reaberta pelo "Desfazer" uma marca `undo`, sem nota. Lá a marca
 * só registra o progresso ("pulada pelo nivelamento" no painel de administração), sem XP, sequência,
 * SRS, conquista nem liga; nunca cobre uma conclusão de verdade, e a lição refeita substitui a marca
 * (services/api/src/usecases/placement.js). Convidado: as marcas vão na migração, ao entrar na conta.
 */

/** Itens por lição testada. */
export const ITEMS_PER_LESSON = 2;
/** Lições do começo do curso que o teste só de reconhecer (sem câmera) pode pular. */
export const NO_CAMERA_MAX_LESSONS = 2;
/** Tempo de cada item, contado com a câmera já ligada (ou com a mão em 3D na tela). */
export const ITEM_TIME_MS: Record<PlacementItemKind, number> = {
  'camera-letter': 20_000,
  'camera-number': 20_000,
  'camera-motion': 25_000,
  choice: 30_000,
};

export type PlacementItemKind = 'camera-letter' | 'camera-motion' | 'camera-number' | 'choice';

export interface PlacementItem {
  lessonId: string;
  signId: string;
  kind: PlacementItemKind;
}

export interface PlacementAnswer {
  correct: boolean;
  /** Como a resposta foi dada: pela câmera ou escolhendo a letra. */
  via: 'camera' | 'choice';
}

/** O que o teste precisa saber de cada sinal (sem puxar o signs.json para cá). */
export interface PlacementSign {
  id: string;
  gloss: string;
  category: string;
}

/** O que a câmera e a mão em 3D deste aparelho conseguem mostrar ou avaliar. */
export interface PlacementCapabilities {
  /** O teste usa a câmera (falso: só reconhecer). */
  camera: boolean;
  letterMotion: (sign: PlacementSign) => boolean;
  staticLetter: (sign: PlacementSign) => boolean;
  number: (sign: PlacementSign) => boolean;
  hand3d: (sign: PlacementSign) => boolean;
}

export type LessonOutcome = 'mastered' | 'missed' | 'needs_camera';

export interface PlacementLessonResult {
  lessonId: string;
  outcome: LessonOutcome;
  /** Sinais acertados no teste (gravados na lição pulada). */
  passedSigns: string[];
}

/* ---------- quais lições e quais sinais ---------- */

const letterUnit = () => course.units[0];
const numberUnit = () => course.units[1];

/** Lições que o teste cobre: a unidade 1 (alfabeto) e, se pedido, a 2 (números). */
export function placementLessons(includeNumbers: boolean): Lesson[] {
  return [...(letterUnit()?.lessons ?? []), ...(includeNumbers ? numberUnit()?.lessons ?? [] : [])];
}

/** A lição está entre as que o teste só de reconhecer pode pular? */
export function withinNoCameraCap(lessonId: string): boolean {
  return (letterUnit()?.lessons ?? []).slice(0, NO_CAMERA_MAX_LESSONS).some(l => l.id === lessonId);
}

/** Como o sinal entra no teste neste aparelho. */
export function itemKind(sign: PlacementSign, caps: PlacementCapabilities): PlacementItemKind {
  if (!caps.camera) return 'choice';
  if (sign.category === 'alfabeto' && caps.letterMotion(sign)) return 'camera-motion';
  if (sign.category === 'alfabeto' && caps.staticLetter(sign)) return 'camera-letter';
  if (sign.category === 'numeros' && caps.number(sign)) return 'camera-number';
  return 'choice';
}

/** De qual lição vem cada sinal (a primeira do curso que o tem). */
function sourceLessons(): Map<string, string> {
  const source = new Map<string, string>();
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      for (const id of lesson.signIds) if (!source.has(id)) source.set(id, lesson.id);
    }
  }
  return source;
}

/** Lição de revisão: nenhum sinal novo (todos vieram de lições anteriores). */
export function isReviewLesson(lesson: Lesson): boolean {
  const source = sourceLessons();
  return lesson.signIds.length > 0 && lesson.signIds.every(id => source.get(id) !== lesson.id);
}

/** Lições de onde vêm os sinais de uma lição de revisão. */
export function reviewSources(lesson: Lesson): string[] {
  const source = sourceLessons();
  return [...new Set(lesson.signIds.map(id => source.get(id)).filter((id): id is string => !!id && id !== lesson.id))];
}

/**
 * Lições de revisão (das cobertas pelo teste, ainda não concluídas) que podem ser puladas junto: todas
 * as lições de origem estão em `skipped` (puladas agora ou num teste anterior). Origem concluída de
 * verdade não basta: quem fez a lição pelo curso faz a revisão dela. Uma revisão pode depender de
 * outra revisão pulada nesta mesma rodada, por isso repete até estabilizar.
 */
export function reviewLessonsToSkip(includeNumbers: boolean, skipped: ReadonlySet<string>, completed: ReadonlySet<string>): string[] {
  const reviews = placementLessons(includeNumbers).filter(l => !completed.has(l.id) && isReviewLesson(l));
  const ok = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const lesson of reviews) {
      if (ok.has(lesson.id)) continue;
      if (reviewSources(lesson).every(id => skipped.has(id) || ok.has(id))) {
        ok.add(lesson.id);
        changed = true;
      }
    }
  }
  return reviews.filter(l => ok.has(l.id)).map(l => l.id);
}

function pickRandom<T>(list: T[], rng: () => number): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

export interface PlanOptions {
  /** Lições já concluídas (de verdade ou por um teste anterior): ficam de fora. */
  completed: ReadonlySet<string>;
  includeNumbers: boolean;
  caps: PlacementCapabilities;
  signs: Record<string, PlacementSign>;
  rng?: () => number;
}

/**
 * Sorteia os itens do teste, lição por lição na ordem do curso. Em cada lição: os sinais novos dela
 * primeiro (a lição do Ç revisa C, J, X e Z), uma letra com movimento que a câmera avalia quando
 * houver, depois os que a câmera avalia, depois os que têm mão em 3D. Dentro da lição, a letra
 * parada vem antes da com movimento.
 */
export function buildPlacementPlan({ completed, includeNumbers, caps, signs, rng = Math.random }: PlanOptions): PlacementItem[] {
  const lessons = placementLessons(includeNumbers && caps.camera)
    .filter(l => !completed.has(l.id) && !isReviewLesson(l))
    .filter(l => caps.camera || withinNoCameraCap(l.id));
  const seenBefore = new Set<string>();
  // Sinais das lições anteriores do curso (mesmo as concluídas), para achar os novos de cada uma
  const earlier = new Map<string, Set<string>>();
  for (const unit of course.units) {
    for (const lesson of unit.lessons) {
      earlier.set(lesson.id, new Set(seenBefore));
      lesson.signIds.forEach(id => seenBefore.add(id));
    }
  }

  const plan: PlacementItem[] = [];
  for (const lesson of lessons) {
    const before = earlier.get(lesson.id) ?? new Set<string>();
    const all = lesson.signIds.filter(id => signs[id]);
    const own = all.filter(id => !before.has(id));
    const others = all.filter(id => before.has(id));
    const kindOf = (id: string) => itemKind(signs[id], caps);
    const picked: string[] = [];
    const take = (pool: string[]) => {
      const id = pickRandom(pool.filter(p => !picked.includes(p)), rng);
      if (id && picked.length < ITEMS_PER_LESSON) picked.push(id);
      return id;
    };

    take(own.filter(id => kindOf(id) === 'camera-motion'));
    const tiers = [own, others].flatMap(group => [
      group.filter(id => kindOf(id) !== 'choice'),
      group.filter(id => kindOf(id) === 'choice' && caps.hand3d(signs[id])),
      group,
    ]);
    for (const tier of tiers) {
      while (picked.length < ITEMS_PER_LESSON && take(tier)) { /* sorteia até completar */ }
    }

    const items = picked.map(signId => ({ lessonId: lesson.id, signId, kind: kindOf(signId) }));
    // Parada antes da com movimento
    items.sort((a, b) => Number(a.kind === 'camera-motion') - Number(b.kind === 'camera-motion'));
    plan.push(...items);
  }
  return plan;
}

/**
 * Próximo item a mostrar a partir de `from`: pula os de lição que já saiu do teste (um item dela
 * errado ou pulado). Devolve plan.length quando acabou.
 */
export function nextItemIndex(plan: PlacementItem[], answers: Record<number, PlacementAnswer>, from: number): number {
  for (let i = from; i < plan.length; i++) {
    const lessonFailed = plan.some((it, j) => j < i && it.lessonId === plan[i].lessonId && answers[j] && !answers[j].correct);
    if (!lessonFailed) return i;
  }
  return plan.length;
}

/**
 * A câmera parou de funcionar no item `at` (permissão negada ou erro): daí em diante só reconhecer.
 * Os itens restantes viram "qual é esta letra?", e saem os de lições que já não podem ser puladas
 * (fora das primeiras e sem acerto pela câmera).
 */
export function withoutCamera(plan: PlacementItem[], answers: Record<number, PlacementAnswer>, at: number): PlacementItem[] {
  const cameraBacked = (lessonId: string) =>
    plan.some((it, j) => j < at && it.lessonId === lessonId && answers[j]?.correct && answers[j]?.via === 'camera');
  const rest = plan.slice(at)
    .filter(it => withinNoCameraCap(it.lessonId) || cameraBacked(it.lessonId))
    .map(it => ({ ...it, kind: 'choice' as const }));
  return [...plan.slice(0, at), ...rest];
}

/**
 * Resultado por lição testada (`lessonIds`: as do plano original, na ordem). Dominada: todos os itens
 * dela respondidos e certos, com pelo menos um acerto pela câmera ou entre as primeiras lições.
 */
export function scorePlacement(
  lessonIds: string[],
  plan: PlacementItem[],
  answers: Record<number, PlacementAnswer>,
): PlacementLessonResult[] {
  return lessonIds.map(lessonId => {
    const idx = plan.map((it, i) => (it.lessonId === lessonId ? i : -1)).filter(i => i >= 0);
    const passedSigns = idx.filter(i => answers[i]?.correct).map(i => plan[i].signId);
    if (idx.length === 0) return { lessonId, outcome: 'needs_camera' as const, passedSigns };
    const allRight = idx.every(i => answers[i]?.correct);
    if (!allRight) return { lessonId, outcome: 'missed' as const, passedSigns };
    const viaCamera = idx.some(i => answers[i]?.via === 'camera');
    const outcome: LessonOutcome = viaCamera || withinNoCameraCap(lessonId) ? 'mastered' : 'needs_camera';
    return { lessonId, outcome, passedSigns };
  });
}

/**
 * 4 opções do "qual é esta letra?": o sinal certo e 3 da mesma lição primeiro (as confusões de
 * verdade), completando com outros da mesma categoria. Sem glosa repetida, em ordem sorteada.
 */
export function drawPlacementOptions(
  target: PlacementSign,
  lessonSignIds: string[],
  signs: Record<string, PlacementSign>,
  rng: () => number = Math.random,
): PlacementSign[] {
  const shuffled = <T,>(list: T[]) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rng() * (i + 1)));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const sameLesson = shuffled(lessonSignIds.map(id => signs[id]).filter(Boolean));
  const sameCategory = shuffled(Object.values(signs).filter(s => s.category === target.category));
  const out: PlacementSign[] = [target];
  const glosses = new Set([target.gloss]);
  for (const s of [...sameLesson, ...sameCategory]) {
    if (out.length === 4) break;
    if (glosses.has(s.gloss)) continue;
    glosses.add(s.gloss);
    out.push(s);
  }
  return shuffled(out);
}

/* ---------- gravação ---------- */

interface ProgressRecord {
  status?: string;
  placement?: boolean;
  placementSigns?: string[];
}

export function isPlacementRecord(rec: unknown): boolean {
  return !!rec && (rec as ProgressRecord).status === 'completed' && (rec as ProgressRecord).placement === true;
}

const DONE_KEY = 'librax_placementDone';

/** O teste foi feito (o resultado foi visto e confirmado ou recusado): o convite sai. */
export function isPlacementDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) !== null;
  } catch {
    return false;
  }
}

export function markPlacementDone(today: string): void {
  try {
    localStorage.setItem(DONE_KEY, today);
  } catch {
    /* sem armazenamento: o convite continua aparecendo */
  }
}

function clearPlacementDone(): void {
  try {
    localStorage.removeItem(DONE_KEY);
  } catch {
    /* nada a fazer */
  }
}

/**
 * Manda as marcas ao servidor pela fila. Falha aqui (banco da fila indisponível) nunca desfaz o que
 * já foi gravado no aparelho.
 */
async function syncMarks(lessonIds: string[], mark: PlacementMark, today: string): Promise<void> {
  if (lessonIds.length === 0) return;
  try {
    await enqueuePlacementMarks(lessonIds, mark, today);
    void flushOutbox().catch(() => {});
  } catch {
    /* sem fila: o aparelho segue certo, o servidor só não fica sabendo */
  }
}

/**
 * Pula as lições escolhidas no resultado: grava cada uma como concluída pelo teste. Só mexe no
 * progresso das lições (nada de perfil, XP do dia, sequência, SRS ou conquistas) e põe as marcas
 * `skip` na fila de envio. Lição já concluída de verdade fica como está. Devolve quantas foram puladas.
 */
export async function applyPlacement(
  repo: IdbRepo,
  userId: string,
  lessons: { lessonId: string; passedSigns: string[] }[],
  today: string,
): Promise<number> {
  const placed: string[] = [];
  for (const { lessonId, passedSigns } of lessons) {
    if (!course.lessonsMap[lessonId]) continue;
    const prev = (await repo.getProgress(userId, lessonId)) as ProgressRecord | null;
    if (prev?.status === 'completed') continue;
    await repo.saveProgress(userId, lessonId, {
      status: 'completed',
      placement: true,
      placementSigns: [...passedSigns],
      completedAt: today,
    });
    placed.push(lessonId);
  }
  markPlacementDone(today);
  await syncMarks(placed, 'skip', today);
  return placed.length;
}

/** Lições ainda marcadas como puladas pelo teste (não refeitas). */
export async function placedLessonIds(repo: IdbRepo, userId: string, lessons: Lesson[] = placementLessons(true)): Promise<string[]> {
  const recs = await Promise.all(lessons.map(l => repo.getProgress(userId, l.id)));
  return lessons.filter((_, i) => isPlacementRecord(recs[i])).map(l => l.id);
}

/**
 * Desfaz o teste: as lições puladas (e não refeitas) voltam a seguir a ordem do curso, e o convite
 * volta. As refeitas continuam concluídas. Só as reabertas vão como marca `undo` para o servidor.
 * Devolve quantas foram reabertas.
 */
export async function undoPlacement(repo: IdbRepo, userId: string, today: string = getToday()): Promise<number> {
  const ids = await placedLessonIds(repo, userId);
  for (const id of ids) await repo.deleteProgress(userId, id);
  clearPlacementDone();
  await syncMarks(ids, 'undo', today);
  return ids.length;
}

export interface PlacementStatus {
  /** O convite aparece (mapa e Configurações): teste não feito e alfabeto ainda não concluído. */
  offer: boolean;
  /** Lições puladas pelo teste, para o "Desfazer". */
  placed: string[];
}

export async function loadPlacementStatus(repo: IdbRepo, userId: string): Promise<PlacementStatus> {
  const letters = letterUnit()?.lessons ?? [];
  const lessons = placementLessons(true);
  const recs = (await Promise.all(lessons.map(l => repo.getProgress(userId, l.id)))) as (ProgressRecord | null)[];
  const unitDone = letters.every(l => recs[lessons.indexOf(l)]?.status === 'completed');
  const placed = lessons.filter((_, i) => isPlacementRecord(recs[i])).map(l => l.id);
  return { offer: !isPlacementDone() && !unitDone, placed };
}
