import type { Exercise } from './content';
import type { ReviewedItem } from '../screens/LessonScreen';
import type { ExerciseStats } from './sync';
import type { LessonCameraStats } from './cameraStats';

/**
 * Lição em andamento (retomada depois de recarregar a página).
 *
 * No celular o Safari descarta abas em segundo plano com frequência e o app recarrega do zero.
 * Para a pessoa não perder onde estava, a lição guarda aqui, a cada exercício respondido, os
 * exercícios já sorteados (opções, distratores, blocos da frase), o ponto atual e os acertos.
 *
 * Fica no localStorage, como os outros marcadores do app (lib/flags.ts), e não no IndexedDB:
 * - a leitura é síncrona, então a rota da lição já abre no exercício certo, sem piscar o primeiro;
 * - sobrevive ao descarte da aba e ao fechar e abrir o app instalado (o sessionStorage some quando
 *   o app é fechado e não serviria à faixa "Retomar" do mapa);
 * - é um rascunho pequeno (poucos KB), descartável e que nunca vai ao servidor: o IndexedDB guarda
 *   o progresso de verdade, que é sincronizado.
 * Vale por 12 horas e só para o mesmo conteúdo da lição (versão do bundle e do formato).
 */

/** Formato do que é guardado. Mudou o formato: o salvo antes é descartado. */
const RUN_FORMAT = 1;
const PREFIX = 'librax_lessonRun:';
export const LESSON_RUN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Onde a lição está: o próximo exercício a mostrar e o que já foi respondido. */
export interface LessonProgress {
  /** Índice do exercício a abrir (o já verificado conta como passado). */
  index: number;
  correct: number;
  attempted: number;
  reviewed: ReviewedItem[];
  /** Sinais apresentados nesta lição (para "sinais novos"). */
  seen: string[];
  /** Respostas e erros por tipo de exercício (painel de administração). Ausente em runs antigos. */
  exerciseStats?: ExerciseStats;
  /** Desempenho da câmera nesta lição (painel de administração). Ausente em runs antigos. */
  cameraStats?: LessonCameraStats;
}

export interface LessonRun extends LessonProgress {
  format: number;
  lessonId: string;
  /** Versão do conteúdo da lição (contentVersion do bundle). */
  version: string;
  /** Hora da última gravação (ms desde 1970). */
  savedAt: number;
  /** Exercícios com os sorteios feitos na primeira abertura. */
  exercises: Exercise[];
}

const key = (userId: string, lessonId: string) => `${PREFIX}${userId}:${lessonId}`;

/** Versão do conteúdo: hash (FNV-1a, 32 bits) do bundle da lição. Mudou o bundle, muda a versão. */
export function contentVersion(bundle: unknown): string {
  const text = JSON.stringify(bundle) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${RUN_FORMAT}-${h.toString(16).padStart(8, '0')}`;
}

function read(storageKey: string): LessonRun | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as LessonRun) : null;
  } catch {
    return null;
  }
}

function isUsable(run: LessonRun | null, now: number): run is LessonRun {
  return !!run
    && run.format === RUN_FORMAT
    && Array.isArray(run.exercises)
    && run.exercises.length > 0
    && typeof run.index === 'number'
    && now - run.savedAt >= 0
    && now - run.savedAt < LESSON_RUN_MAX_AGE_MS;
}

export function saveLessonRun(userId: string, run: Omit<LessonRun, 'format' | 'savedAt'>, now = Date.now()): void {
  try {
    localStorage.setItem(key(userId, run.lessonId), JSON.stringify({ ...run, format: RUN_FORMAT, savedAt: now }));
  } catch {
    // Sem espaço ou modo privado: a lição segue, só não retoma depois
  }
}

/** A lição salva, se ainda vale (mesma versão do conteúdo e menos de 12 horas). A velha é apagada. */
export function loadLessonRun(userId: string, lessonId: string, version: string, now = Date.now()): LessonRun | null {
  const run = read(key(userId, lessonId));
  if (!run) return null;
  if (!isUsable(run, now) || run.lessonId !== lessonId || run.version !== version) {
    clearLessonRun(userId, lessonId);
    return null;
  }
  return run;
}

export function clearLessonRun(userId: string, lessonId: string): void {
  try {
    localStorage.removeItem(key(userId, lessonId));
  } catch {
    // nada a fazer
  }
}

/** A lição em andamento mais recente da pessoa (faixa "Retomar" do mapa), sem conferir a versão. */
export function latestLessonRun(userId: string, now = Date.now()): LessonRun | null {
  let best: LessonRun | null = null;
  try {
    const prefix = `${PREFIX}${userId}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(prefix)) continue;
      const run = read(k);
      if (isUsable(run, now) && (!best || run.savedAt > best.savedAt)) best = run;
    }
  } catch {
    return null;
  }
  return best;
}
