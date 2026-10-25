import { LETTER_MOTION_DIR } from './mlAssets';
import { parseMlp, type MlpModel } from './mlp';
import { NORMALIZATION_VERSION } from './normalize';
import {
  LETTER_FRAME_DIM, LETTER_INPUT_DIM, LETTER_MODEL_FRAMES, LETTER_WINDOW_FRAMES, LETTER_WINDOWS_S, NO_LETTER,
} from './letterMotion';

/**
 * Modelo das letras com movimento (ml-training/train_letras_mov.py treinar), em /ml/letras-mov/.
 *
 * - model.json: o mesmo librax-mlp das letras paradas, com kind "letras-mov", frames,
 *   features_per_frame, window_frames e windows_s. Rótulos: as letras e "_" (nenhuma letra com
 *   movimento).
 * - weights.bin: pesos float32 (mlp.ts).
 *
 * Sem modelo publicado nada muda: H e K continuam com o modelo das letras paradas (a forma da mão)
 * e J, Z e Ç como prática livre. O model.json é lido uma vez por sessão, ao abrir a lição; os pesos,
 * quando um exercício de letra com movimento abre.
 */

const INDEX_TIMEOUT_MS = 4000;

export interface LetterMotionIndex {
  labels: string[];
  /** Letras que a câmera avalia com o movimento (camera_letters, sem "_"). */
  letters: ReadonlySet<string>;
  weightsFile: string;
  json: unknown;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Confere o model.json contra o contrato do app. Devolve o motivo quando não serve. */
export function checkLetterMotionModelJson(json: unknown): string | null {
  const m = json as Record<string, unknown> | null;
  if (!m || m.format !== 'librax-mlp') return 'não é um librax-mlp';
  if (m.kind !== 'letras-mov') return `kind ${String(m.kind)} (esperado "letras-mov")`;
  if (m.normalization_version !== NORMALIZATION_VERSION) {
    return `normalization_version ${String(m.normalization_version)}, o app usa ${NORMALIZATION_VERSION}`;
  }
  if (m.frames !== LETTER_MODEL_FRAMES || m.features_per_frame !== LETTER_FRAME_DIM || m.window_frames !== LETTER_WINDOW_FRAMES) {
    return `janela ${String(m.frames)}x${String(m.features_per_frame)} de ${String(m.window_frames)}, o app monta ${LETTER_MODEL_FRAMES}x${LETTER_FRAME_DIM} de ${LETTER_WINDOW_FRAMES}`;
  }
  const windows = m.windows_s;
  if (!Array.isArray(windows) || windows.length !== LETTER_WINDOWS_S.length || windows.some((w, i) => w !== LETTER_WINDOWS_S[i])) {
    return `janelas ${JSON.stringify(windows)}, o app avalia ${JSON.stringify(LETTER_WINDOWS_S)}`;
  }
  if (m.input_dim !== LETTER_INPUT_DIM) return `input_dim ${String(m.input_dim)}, esperado ${LETTER_INPUT_DIM}`;
  if (!Array.isArray(m.labels) || !m.labels.includes(NO_LETTER)) return `sem a classe "${NO_LETTER}"`;
  if (m.camera_letters !== undefined && !Array.isArray(m.camera_letters)) return 'camera_letters não é uma lista';
  return null;
}

/**
 * Letras que a câmera avalia: as de camera_letters (as que passaram no teste com pessoas nunca
 * vistas, ml-training/train_letras_mov.py). As outras ficam no modelo só para não virarem outra
 * letra; continuam como hoje no app. Sem a lista, todas as do modelo.
 */
function cameraLetters(json: Record<string, unknown>, labels: readonly string[]): ReadonlySet<string> {
  const listed = Array.isArray(json.camera_letters) ? json.camera_letters.map(String) : null;
  return new Set(labels.filter(l => l !== NO_LETTER && (!listed || listed.includes(l))));
}

let index: LetterMotionIndex | null = null;
let indexLoading: Promise<LetterMotionIndex | null> | null = null;
let model: Promise<MlpModel | null> | null = null;

async function fetchIndex(): Promise<LetterMotionIndex | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), INDEX_TIMEOUT_MS);
  try {
    // Accept JSON: sem isso o servidor de desenvolvimento devolve o index.html no lugar do 404
    const res = await fetch(`${LETTER_MOTION_DIR}/model.json`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const json = await res.json();
    const problem = checkLetterMotionModelJson(json);
    if (problem) {
      console.warn(`[letras-mov] model.json fora do contrato (${problem}): letras com movimento seguem como hoje`);
      return null;
    }
    const labels = (json.labels as unknown[]).map(String);
    const weightsFile = typeof json.weights?.file === 'string' ? json.weights.file : 'weights.bin';
    return { labels, letters: cameraLetters(json, labels), weightsFile, json };
  } catch {
    // Sem modelo, offline ou sem resposta a tempo: segue sem
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o model.json uma vez por sessão. Resolve com as letras avaliadas com movimento (vazio sem modelo). */
export function loadLetterMotionIndex(): Promise<ReadonlySet<string>> {
  if (!indexLoading) {
    indexLoading = fetchIndex().then(found => {
      index = found;
      return found;
    });
  }
  return indexLoading.then(found => found?.letters ?? EMPTY);
}

/** Letras que a câmera avalia com o movimento agora (vazio até o loadLetterMotionIndex terminar, ou sem modelo). */
export function getMotionLetters(): ReadonlySet<string> {
  return index?.letters ?? EMPTY;
}

/** O modelo com os pesos, carregado na primeira vez que um exercício de letra com movimento abre. */
export function loadLetterMotionModel(): Promise<MlpModel | null> {
  if (!model) {
    model = (async () => {
      await loadLetterMotionIndex();
      const found = index;
      if (!found) return null;
      try {
        const res = await fetch(`${LETTER_MOTION_DIR}/${found.weightsFile}`);
        if (!res.ok) return null;
        return parseMlp(found.json, await res.arrayBuffer());
      } catch (err) {
        if (err instanceof Error && err.name === 'MlpFormatError') console.warn('[letras-mov]', err.message);
        return null;
      }
    })();
    // Falhou (rede): a próxima vez tenta de novo
    model.then(m => { if (!m) model = null; });
  }
  return model;
}

/** Só para testes: define o modelo (ou esquece tudo com null). */
export function setLetterMotionModelForTests(next: { model: MlpModel } | null): void {
  if (!next) {
    index = null;
    indexLoading = null;
    model = null;
    return;
  }
  const labels = next.model.labels;
  index = { labels, letters: new Set(labels.filter(l => l !== NO_LETTER)), weightsFile: 'weights.bin', json: null };
  indexLoading = Promise.resolve(index);
  model = Promise.resolve(next.model);
}
