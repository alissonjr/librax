import { createMlpClassifier, NO_LETTER_LABEL, type Classifier } from './classifier';
import { NUMBERS_DIR } from './mlAssets';
import { FEATURE_DIM, NORMALIZATION_VERSION } from './normalize';
import { parseMlp } from './mlp';

/**
 * Modelo dos números de 0 a 9 (forma cardinal, mão parada; ml-training/train_numeros15.py), em
 * /ml/numeros/.
 *
 * - model.json: o mesmo librax-mlp das letras paradas (65 entradas, normalização v2), com kind
 *   "numeros" e camera_numbers: os números que passaram no teste com pessoas nunca vistas. Os
 *   outros ficam no modelo só para não virarem um número errado; continuam como prática livre.
 * - weights.bin: pesos float32 (mlp.ts).
 *
 * A leitura é a das letras paradas (createMlpClassifier: limiar 0,6, "_" vira nada) e o exercício
 * é o mesmo ExerciseCameraSign. Sem modelo publicado nada muda. O model.json é lido uma vez por
 * sessão, ao abrir a lição; os pesos, quando um exercício de número abre.
 */

const INDEX_TIMEOUT_MS = 4000;

interface NumberIndex {
  numbers: ReadonlySet<string>;
  weightsFile: string;
  json: unknown;
}

const EMPTY: ReadonlySet<string> = new Set();

/** Confere o model.json contra o contrato do app. Devolve o motivo quando não serve. */
export function checkNumberModelJson(json: unknown): string | null {
  const m = json as Record<string, unknown> | null;
  if (!m || m.format !== 'librax-mlp') return 'não é um librax-mlp';
  if (m.kind !== 'numeros') return `kind ${String(m.kind)} (esperado "numeros")`;
  if (m.normalization_version !== NORMALIZATION_VERSION) {
    return `normalization_version ${String(m.normalization_version)}, o app usa ${NORMALIZATION_VERSION}`;
  }
  if (m.input_dim !== FEATURE_DIM) return `input_dim ${String(m.input_dim)}, esperado ${FEATURE_DIM}`;
  if (!Array.isArray(m.labels) || !m.labels.includes(NO_LETTER_LABEL)) return `sem a classe "${NO_LETTER_LABEL}"`;
  if (!Array.isArray(m.camera_numbers)) return 'sem camera_numbers';
  return null;
}

/** Números que a câmera avalia: os de camera_numbers que também estão nos rótulos. */
function cameraNumbers(json: Record<string, unknown>): ReadonlySet<string> {
  const labels = (json.labels as unknown[]).map(String);
  return new Set((json.camera_numbers as unknown[]).map(String).filter(n => n !== NO_LETTER_LABEL && labels.includes(n)));
}

let index: NumberIndex | null = null;
let indexLoading: Promise<NumberIndex | null> | null = null;
let classifier: Promise<Classifier | null> | null = null;

async function fetchIndex(): Promise<NumberIndex | null> {
  if (typeof fetch !== 'function') return null;
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), INDEX_TIMEOUT_MS);
  try {
    // Accept JSON: sem isso o servidor de desenvolvimento devolve o index.html no lugar do 404
    const res = await fetch(`${NUMBERS_DIR}/model.json`, {
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const json = await res.json();
    const problem = checkNumberModelJson(json);
    if (problem) {
      console.warn(`[numeros] model.json fora do contrato (${problem}): números seguem como prática livre`);
      return null;
    }
    const weightsFile = typeof json.weights?.file === 'string' ? json.weights.file : 'weights.bin';
    return { numbers: cameraNumbers(json), weightsFile, json };
  } catch {
    // Sem modelo, offline ou sem resposta a tempo: segue sem
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lê o model.json uma vez por sessão. Resolve com os números avaliados pela câmera (vazio sem modelo). */
export function loadNumberIndex(): Promise<ReadonlySet<string>> {
  if (!indexLoading) {
    indexLoading = fetchIndex().then(found => {
      index = found;
      return found;
    });
  }
  return indexLoading.then(found => found?.numbers ?? EMPTY);
}

/** Números que a câmera avalia agora (vazio até o loadNumberIndex terminar, ou sem modelo). */
export function getCameraNumbers(): ReadonlySet<string> {
  return index?.numbers ?? EMPTY;
}

/** O classificador dos números, com os pesos, carregado na primeira vez que um exercício de número abre. */
export function loadNumberClassifier(): Promise<Classifier | null> {
  if (!classifier) {
    classifier = (async () => {
      await loadNumberIndex();
      const found = index;
      if (!found) return null;
      try {
        const res = await fetch(`${NUMBERS_DIR}/${found.weightsFile}`);
        if (!res.ok) return null;
        const model = parseMlp(found.json, await res.arrayBuffer());
        // Só os números que passaram contam como avaliáveis; os outros rótulos seguem no modelo
        return { ...createMlpClassifier(model), letters: found.numbers };
      } catch (err) {
        if (err instanceof Error && err.name === 'MlpFormatError') console.warn('[numeros]', err.message);
        return null;
      }
    })();
    // Falhou (rede): a próxima vez tenta de novo
    classifier.then(c => { if (!c) classifier = null; });
  }
  return classifier;
}

/** Só para testes: define o classificador e os números avaliados (ou esquece tudo com null). */
export function setNumberClassifierForTests(next: { classifier: Classifier; numbers: string[] } | null): void {
  if (!next) {
    index = null;
    indexLoading = null;
    classifier = null;
    return;
  }
  index = { numbers: new Set(next.numbers), weightsFile: 'weights.bin', json: null };
  indexLoading = Promise.resolve(index);
  classifier = Promise.resolve(next.classifier);
}
