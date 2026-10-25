import { SIGN_MODEL_DIR } from './mlAssets';
import { parseMlp, type MlpModel } from './mlp';
import { NORMALIZATION_VERSION } from './normalize';
import { MODEL_FRAMES, SIGN_FRAME_DIM, SIGN_INPUT_DIM, WINDOW_FRAMES } from './signFeatures';

/**
 * Modelo dos sinais com movimento (ml-training/train_sinais.py treinar), em /ml/sinais/.
 *
 * - model.json: o mesmo librax-mlp das letras, com kind "sinais", frames, features_per_frame e
 *   window_frames. Rótulos: as glosas e "_" (nenhum sinal).
 * - weights.bin: pesos float32 (mlp.ts).
 *
 * Sem modelo publicado (o normal hoje) nada muda: os exercícios de sinal com movimento continuam
 * como prática livre. O model.json é lido uma vez por sessão, ao abrir a lição, para saber quais
 * glosas a câmera avalia; os pesos só quando um exercício desses abre.
 */

/** Rótulo do modelo que quer dizer "nenhum sinal" (mão em repouso, fala, transição). */
export const NO_SIGN_LABEL = '_';
/** Abaixo disto a leitura vira "nenhum sinal" (o mesmo limiar das letras e do train_sinais.py). */
export const SIGN_MIN_PROBABILITY = 0.6;
/** Sem resposta do model.json neste tempo, a lição abre sem a câmera dos sinais. */
const INDEX_TIMEOUT_MS = 4000;

export interface SignModelIndex {
  /** Rótulos na ordem das saídas do modelo. */
  labels: string[];
  /** Glosas que o modelo reconhece (sem "_"). */
  glosses: ReadonlySet<string>;
  weightsFile: string;
  json: unknown;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Confere o model.json contra o contrato do app. Devolve o motivo quando não serve. */
export function checkSignModelJson(json: unknown): string | null {
  const m = json as Record<string, unknown> | null;
  if (!m || m.format !== 'librax-mlp') return 'não é um librax-mlp';
  if (m.kind !== 'sinais') return `kind ${String(m.kind)} (esperado "sinais")`;
  if (m.normalization_version !== NORMALIZATION_VERSION) {
    return `normalization_version ${String(m.normalization_version)}, o app usa ${NORMALIZATION_VERSION}`;
  }
  if (m.frames !== MODEL_FRAMES || m.features_per_frame !== SIGN_FRAME_DIM || m.window_frames !== WINDOW_FRAMES) {
    return `janela ${String(m.frames)}x${String(m.features_per_frame)} de ${String(m.window_frames)}, o app monta ${MODEL_FRAMES}x${SIGN_FRAME_DIM} de ${WINDOW_FRAMES}`;
  }
  if (m.input_dim !== SIGN_INPUT_DIM) return `input_dim ${String(m.input_dim)}, esperado ${SIGN_INPUT_DIM}`;
  if (!Array.isArray(m.labels) || !m.labels.includes(NO_SIGN_LABEL)) return `sem a classe "${NO_SIGN_LABEL}"`;
  return null;
}

let index: SignModelIndex | null = null;
let indexLoading: Promise<SignModelIndex | null> | null = null;
let model: Promise<MlpModel | null> | null = null;

async function fetchIndex(): Promise<SignModelIndex | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), INDEX_TIMEOUT_MS);
  try {
    // Accept JSON: sem isso o servidor de desenvolvimento devolve o index.html no lugar do 404
    const res = await fetch(`${SIGN_MODEL_DIR}/model.json`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const json = await res.json();
    const problem = checkSignModelJson(json);
    if (problem) {
      console.warn(`[sinais] model.json fora do contrato (${problem}): sinais com movimento seguem sem câmera`);
      return null;
    }
    const labels = (json.labels as unknown[]).map(String);
    const weightsFile = typeof json.weights?.file === 'string' ? json.weights.file : 'weights.bin';
    return { labels, glosses: new Set(labels.filter(l => l !== NO_SIGN_LABEL)), weightsFile, json };
  } catch {
    // Sem modelo, offline ou sem resposta a tempo: segue sem
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o model.json uma vez por sessão. Resolve com as glosas avaliáveis (vazio sem modelo). */
export function loadSignIndex(): Promise<ReadonlySet<string>> {
  if (!indexLoading) {
    indexLoading = fetchIndex().then(found => {
      index = found;
      return found;
    });
  }
  return indexLoading.then(found => found?.glosses ?? EMPTY);
}

/** Glosas que a câmera avalia agora (vazio até o loadSignIndex terminar, ou sem modelo). */
export function getSignGlosses(): ReadonlySet<string> {
  return index?.glosses ?? EMPTY;
}

/** Há modelo de sinais publicado (depois do loadSignIndex)? */
export function hasSignModel(): boolean {
  return !!index;
}

/** O modelo com os pesos, carregado na primeira vez que um exercício de sinal abre. Null sem modelo. */
export function loadSignModel(): Promise<MlpModel | null> {
  if (!model) {
    model = (async () => {
      await loadSignIndex();
      const found = index;
      if (!found) return null;
      try {
        const res = await fetch(`${SIGN_MODEL_DIR}/${found.weightsFile}`);
        if (!res.ok) return null;
        return parseMlp(found.json, await res.arrayBuffer());
      } catch (err) {
        if (err instanceof Error && err.name === 'MlpFormatError') console.warn('[sinais]', err.message);
        return null;
      }
    })();
    // Falhou (rede): a próxima vez tenta de novo
    model.then(m => { if (!m) model = null; });
  }
  return model;
}

/** Só para testes: define o modelo (ou esquece tudo com null). */
export function setSignModelForTests(next: { model: MlpModel } | null): void {
  if (!next) {
    index = null;
    indexLoading = null;
    model = null;
    return;
  }
  const labels = next.model.labels;
  index = { labels, glosses: new Set(labels.filter(l => l !== NO_SIGN_LABEL)), weightsFile: 'weights.bin', json: null };
  indexLoading = Promise.resolve(index);
  model = Promise.resolve(next.model);
}
