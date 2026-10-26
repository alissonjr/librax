import { getDb, type LibraxDB } from './db';

/**
 * Desempenho da câmera por sinal (plano de lições pós-treino, seção 7).
 *
 * Para saber onde o reconhecimento ou a descrição do sinal falham, cada exercício de câmera
 * (letra parada, cada letra da soletração e sinal com movimento) soma aqui, por sinal:
 * - acertos e pulos;
 * - tentativas até acertar: cada leitura estável da câmera conta uma tentativa (a errada e a certa);
 * - leituras de outro sinal (a letra K lida como H soma 1 em `wrongReadings.H`).
 *
 * Só números e rótulos do próprio curso: nenhuma imagem, ponto da mão ou texto livre. O acumulado
 * fica no IndexedDB do app (store `camera_stats`, db.ts), funciona sem internet e sai junto no
 * "Excluir conta e dados" (IdbRepo.clearAllData).
 *
 * Para o painel de administração somar os números de todas as pessoas, a lição também junta o que
 * foi produzido nela (`LessonCameraStats`, só a diferença da lição, nunca o acumulado) e manda com
 * a conclusão (`cameraStats` em `POST /v1/lesson/complete`, pela fila offline de sync.ts). Sem conta
 * a conclusão fica na fila e só vai na migração, quando a pessoa entra numa conta.
 */

export const CAMERA_STATS_STORE = 'camera_stats';

/** Formato do arquivo exportado. Mudou o formato, sobe a versão. */
export const CAMERA_STATS_FORMAT = 1;

/** Letra parada (alfabeto, também na soletração), número de 0 a 9 ou sinal com movimento. */
export type CameraSignKind = 'letter' | 'number' | 'sign';

export interface CameraSignStats {
  signId: string;
  /** Glosa mostrada no exercício (A, MESA). */
  label: string;
  kind: CameraSignKind;
  successes: number;
  skips: number;
  /** Soma das tentativas das vezes que terminaram em acerto (média = attemptsToSuccess / successes). */
  attemptsToSuccess: number;
  /** Leituras de outro sinal no lugar deste: rótulo lido -> vezes. */
  wrongReadings: Record<string, number>;
  /** Última gravação (ISO 8601). */
  updatedAt: string;
}

/** Como terminou uma vez de um sinal na câmera. */
export type CameraRunOutcome = 'success' | 'skip';

export interface CameraRunResult {
  signId: string;
  label: string;
  kind: CameraSignKind;
  outcome: CameraRunOutcome;
  wrongReadings: Record<string, number>;
}

/** Rótulos aceitos: letras e glosas do curso (sem espaço livre nem texto longo). */
const LABEL_RE = /^[\p{Lu}\p{N}_-]{1,40}$/u;
/** Teto de rótulos errados guardados por sinal (o resto some nos menos frequentes). */
const MAX_WRONG_LABELS = 20;

/**
 * Uma vez de um sinal na câmera, do momento em que a câmera abre até acertar ou pular.
 *
 * `observe` recebe cada leitura estável (letra confirmada ou glosa da avaliação, null sem leitura).
 * Só a troca de leitura conta: a mesma letra parada na tela não vira várias tentativas.
 */
export class CameraRun {
  private wrong: Record<string, number> = {};
  private last: string | null;
  private done = false;
  /** A câmera chegou a ficar ativa: sem isso, pular não diz nada do reconhecimento. */
  started = false;

  constructor(
    readonly signId: string,
    readonly label: string,
    readonly kind: CameraSignKind,
    /** Leitura já na tela quando a vez começa (a letra que acabou de ser aceita na soletração). */
    initialReading: string | null = null,
  ) {
    this.last = initialReading;
  }

  get finished(): boolean {
    return this.done;
  }

  /**
   * Nova leitura da câmera. `ignore` é uma leitura que não conta como erro (na soletração, a letra
   * anterior ainda na mão enquanto a pessoa troca de forma).
   */
  observe(reading: string | null, ignore: string | null = null): void {
    if (this.done || reading === this.last) return;
    this.last = reading;
    if (reading === null || reading === this.label || reading === ignore) return;
    if (!LABEL_RE.test(reading)) return;
    this.wrong[reading] = (this.wrong[reading] ?? 0) + 1;
  }

  /** Fecha a vez. Devolve null se já foi fechada ou se a câmera nunca ficou ativa. */
  finish(outcome: CameraRunOutcome): CameraRunResult | null {
    if (this.done) return null;
    this.done = true;
    if (!this.started) return null;
    return { signId: this.signId, label: this.label, kind: this.kind, outcome, wrongReadings: { ...this.wrong } };
  }
}

/** Tentativas de uma vez: as leituras erradas mais a certa, quando acertou. */
export function attemptsOf(run: CameraRunResult): number {
  const wrong = Object.values(run.wrongReadings).reduce((a, b) => a + b, 0);
  return wrong + (run.outcome === 'success' ? 1 : 0);
}

/** Soma uma vez ao acumulado do sinal. Função pura. */
export function applyRun(prev: CameraSignStats | undefined, run: CameraRunResult, now: Date = new Date()): CameraSignStats {
  const base: CameraSignStats = prev ?? {
    signId: run.signId,
    label: run.label,
    kind: run.kind,
    successes: 0,
    skips: 0,
    attemptsToSuccess: 0,
    wrongReadings: {},
    updatedAt: now.toISOString(),
  };
  const wrongReadings = { ...base.wrongReadings };
  for (const [label, n] of Object.entries(run.wrongReadings)) {
    if (n > 0) wrongReadings[label] = (wrongReadings[label] ?? 0) + n;
  }
  return {
    ...base,
    label: run.label,
    kind: run.kind,
    successes: base.successes + (run.outcome === 'success' ? 1 : 0),
    skips: base.skips + (run.outcome === 'skip' ? 1 : 0),
    attemptsToSuccess: base.attemptsToSuccess + (run.outcome === 'success' ? attemptsOf(run) : 0),
    wrongReadings: trimWrong(wrongReadings),
    updatedAt: now.toISOString(),
  };
}

function trimWrong(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length <= MAX_WRONG_LABELS) return map;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_WRONG_LABELS));
}

/** Números de um sinal para a tela, já calculados. */
export interface CameraSignSummary extends CameraSignStats {
  runs: number;
  /** Pulos / vezes (0 a 1). */
  skipRate: number;
  /** Média de tentativas até acertar; null sem nenhum acerto. */
  avgAttempts: number | null;
  /** Leituras erradas mais comuns, da mais frequente para a menos. */
  topWrong: { label: string; count: number }[];
  level: DifficultyLevel;
}

export type DifficultyLevel = 'hard' | 'attention' | 'ok';

/** Muitos pulos ou muitas tentativas: modelo fraco ou descrição confusa. */
export function difficultyOf(skipRate: number, avgAttempts: number | null): DifficultyLevel {
  if (skipRate >= 0.5 || (avgAttempts ?? 0) >= 3) return 'hard';
  if (skipRate >= 0.2 || (avgAttempts ?? 0) >= 2) return 'attention';
  return 'ok';
}

export function summarize(stats: CameraSignStats, topN = 3): CameraSignSummary {
  const runs = stats.successes + stats.skips;
  const skipRate = runs > 0 ? stats.skips / runs : 0;
  const avgAttempts = stats.successes > 0 ? stats.attemptsToSuccess / stats.successes : null;
  const topWrong = Object.entries(stats.wrongReadings)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topN)
    .map(([label, count]) => ({ label, count }));
  return { ...stats, runs, skipRate, avgAttempts, topWrong, level: difficultyOf(skipRate, avgAttempts) };
}

/**
 * Do mais difícil para o mais fácil: taxa de pulo, depois média de tentativas (sem acerto conta
 * como o pior caso), depois quantas vezes apareceu (mais dados primeiro) e o rótulo.
 */
export function rankByDifficulty(all: CameraSignStats[]): CameraSignSummary[] {
  return all
    .map(s => summarize(s))
    .filter(s => s.runs > 0)
    .sort((a, b) =>
      b.skipRate - a.skipRate
      || (b.avgAttempts ?? Infinity) - (a.avgAttempts ?? Infinity)
      || b.runs - a.runs
      || a.label.localeCompare(b.label));
}

// --- IndexedDB ---

/** Soma uma vez ao sinal, numa transação só (leitura e escrita juntas). */
export async function recordCameraRun(run: CameraRunResult, db?: LibraxDB, now: Date = new Date()): Promise<CameraSignStats> {
  const d = db ?? (await getDb());
  const tx = d.transaction(CAMERA_STATS_STORE, 'readwrite');
  const prev = (await tx.store.get(run.signId)) as CameraSignStats | undefined;
  const next = applyRun(prev, run, now);
  await tx.store.put(next);
  await tx.done;
  return next;
}

export async function listCameraStats(db?: LibraxDB): Promise<CameraSignStats[]> {
  const d = db ?? (await getDb());
  return (await d.getAll(CAMERA_STATS_STORE)) as CameraSignStats[];
}

export async function clearCameraStats(db?: LibraxDB): Promise<void> {
  const d = db ?? (await getDb());
  await d.clear(CAMERA_STATS_STORE);
}

/**
 * Grava sem esperar e sem quebrar o exercício: a medição nunca atrapalha a lição
 * (IndexedDB indisponível, modo privado, cota cheia). Também avisa a lição aberta (onCameraRun).
 */
export function saveCameraRun(run: CameraRunResult | null): void {
  if (!run) return;
  for (const listener of [...runListeners]) {
    try {
      listener(run);
    } catch {
      // quem ouve nunca quebra o exercício
    }
  }
  void recordCameraRun(run).catch(() => {});
}

// --- Diferença da lição (vai com a conclusão) ---

/** Uma letra ou sinal numa lição: o formato de `cameraStats` na conclusão (services/api, lessonCompletion.js). */
export interface LessonCameraSign {
  successes: number;
  skips: number;
  /** Tentativas das vezes que terminaram em acerto. */
  attempts: number;
  /** Leituras de outro sinal no lugar deste: rótulo lido -> vezes. */
  wrong: Record<string, number>;
}

/** O que a câmera produziu numa lição, por sinal. */
export type LessonCameraStats = Record<string, LessonCameraSign>;

/** Teto de rótulos errados por sinal numa lição (o servidor descarta o sinal que passar disso). */
export const LESSON_MAX_WRONG_LABELS = 8;

/** Soma uma vez à diferença da lição. Função pura. */
export function addRunToLesson(stats: LessonCameraStats, run: CameraRunResult): LessonCameraStats {
  const prev = stats[run.signId] ?? { successes: 0, skips: 0, attempts: 0, wrong: {} };
  const wrong = { ...prev.wrong };
  for (const [label, n] of Object.entries(run.wrongReadings)) {
    if (n > 0) wrong[label] = (wrong[label] ?? 0) + n;
  }
  const entries = Object.entries(wrong);
  const trimmed = entries.length <= LESSON_MAX_WRONG_LABELS
    ? wrong
    : Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, LESSON_MAX_WRONG_LABELS));
  return {
    ...stats,
    [run.signId]: {
      successes: prev.successes + (run.outcome === 'success' ? 1 : 0),
      skips: prev.skips + (run.outcome === 'skip' ? 1 : 0),
      attempts: prev.attempts + (run.outcome === 'success' ? attemptsOf(run) : 0),
      wrong: trimmed,
    },
  };
}

type RunListener = (run: CameraRunResult) => void;
const runListeners = new Set<RunListener>();

/**
 * Ouve cada vez fechada na câmera (a lição aberta junta a sua diferença). Devolve a função que
 * para de ouvir.
 */
export function onCameraRun(listener: RunListener): () => void {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

/** Arquivo exportado: só os números por sinal, sem identificador da pessoa nem do aparelho. */
export interface CameraStatsExport {
  format: number;
  exportedAt: string;
  signs: CameraSignStats[];
}

export function buildCameraStatsExport(all: CameraSignStats[], now: Date = new Date()): CameraStatsExport {
  const signs = [...all].sort((a, b) => a.signId.localeCompare(b.signId));
  return { format: CAMERA_STATS_FORMAT, exportedAt: now.toISOString(), signs };
}
