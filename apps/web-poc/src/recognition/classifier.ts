import { useEffect, useSyncExternalStore } from 'react';
import { getFingerExtensions, recognizeGesture, type FingerExtensions, type Lm } from '../lib/recognizer';
import { CLASSIFIER_DIR } from './mlAssets';
import { classify as classifyMlp, parseMlp, type MlpModel } from './mlp';
import { normalizeHand, NORMALIZATION_VERSION } from './normalize';

/**
 * Qual classificador avalia a letra estática.
 *
 * - Se existir /ml/classifier/model.json (+ weights.bin) com a normalization_version do app,
 *   usa o MLP treinado pelo ml-training/train_static.py.
 * - Senão (hoje, enquanto não há dataset), cai no reconhecedor heurístico de src/lib/recognizer.ts.
 *
 * O carregamento é tentado uma vez por sessão; a tela que precisa saber as letras avaliáveis
 * usa useRecognizableLetters, que se atualiza quando o MLP chega.
 */

export type ClassifierKind = 'mlp' | 'heuristic';

export interface Classification {
  letter: string | null;
  /** Heurístico: fração de dedos que bate com o padrão. MLP: probabilidade da letra. */
  confidence: number;
  /** Dedos estendidos (usado na dica visual dos exercícios, vale para os dois). */
  extensions: FingerExtensions;
}

export interface ClassifyContext {
  /** categoryName do MediaPipe ('Left' ou 'Right'). */
  handedness: string | null;
  /** Largura / altura do quadro. */
  aspect: number;
}

export interface Classifier {
  kind: ClassifierKind;
  letters: ReadonlySet<string>;
  classify(landmarks: Lm[], ctx: ClassifyContext): Classification;
}

/** Letras que o heurístico distingue (as outras ficam sem nota pela câmera). */
export const HEURISTIC_LETTERS: ReadonlySet<string> = new Set(['A', 'B', 'D', 'F', 'I', 'L', 'U', 'V', 'W', 'Y']);

/** Abaixo disto a leitura do MLP vira "nenhuma letra". Calibrar com dados reais (spec-01 seção 6). */
export const MLP_MIN_PROBABILITY = 0.6;

const heuristic: Classifier = {
  kind: 'heuristic',
  letters: HEURISTIC_LETTERS,
  classify(landmarks) {
    return recognizeGesture(landmarks);
  },
};

/**
 * Classe do modelo que quer dizer "não é letra nenhuma" (mão em repouso, em transição, descendo).
 * Sem ela, qualquer mão vira alguma letra com confiança alta. Nunca aparece como letra avaliável.
 */
export const NO_LETTER_LABEL = '_';

export function createMlpClassifier(model: MlpModel): Classifier {
  return {
    kind: 'mlp',
    letters: new Set(model.labels.filter(l => l !== NO_LETTER_LABEL)),
    classify(landmarks, ctx) {
      const input = normalizeHand(landmarks, ctx);
      const extensions = getFingerExtensions(landmarks);
      if (input.length === 0) return { letter: null, confidence: 0, extensions };
      const { label, probability } = classifyMlp(model, input);
      if (label === NO_LETTER_LABEL) return { letter: null, confidence: 0, extensions };
      return { letter: probability >= MLP_MIN_PROBABILITY ? label : null, confidence: probability, extensions };
    },
  };
}

let current: Classifier = heuristic;
let loading: Promise<Classifier> | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: Classifier) {
  current = next;
  listeners.forEach(l => l());
}

/** O classificador em uso agora (heurístico até o MLP carregar). */
export function getClassifier(): Classifier {
  return current;
}

async function fetchMlp(): Promise<MlpModel | null> {
  if (typeof fetch !== 'function') return null;
  try {
    // Accept JSON: sem isso o servidor de desenvolvimento devolve o index.html no lugar do 404
    const res = await fetch(`${CLASSIFIER_DIR}/model.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const json = await res.json();
    if (json?.normalization_version !== NORMALIZATION_VERSION) {
      console.warn(
        `[classifier] model.json com normalization_version ${json?.normalization_version}, o app usa ${NORMALIZATION_VERSION}: ficando no heurístico`,
      );
      return null;
    }
    const file = typeof json.weights?.file === 'string' ? json.weights.file : 'weights.bin';
    const weights = await fetch(`${CLASSIFIER_DIR}/${file}`);
    if (!weights.ok) return null;
    return parseMlp(json, await weights.arrayBuffer());
  } catch (err) {
    // Sem modelo publicado (o normal hoje), offline ou arquivo inválido: segue no heurístico
    if (err instanceof Error && err.name === 'MlpFormatError') console.warn('[classifier]', err.message);
    return null;
  }
}

/** Tenta carregar o MLP uma vez por sessão. Resolve com o classificador que ficou valendo. */
export function loadClassifier(): Promise<Classifier> {
  if (!loading) {
    loading = fetchMlp().then(model => {
      if (model) setCurrent(createMlpClassifier(model));
      return current;
    });
  }
  return loading;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Letras que a câmera avalia agora. Dispara o carregamento do MLP na primeira vez. */
export function useRecognizableLetters(): ReadonlySet<string> {
  useEffect(() => { loadClassifier(); }, []);
  return useSyncExternalStore(subscribe, () => current.letters, () => current.letters);
}

/** Qual classificador está em uso (para telemetria e telas de diagnóstico). */
export function useClassifierKind(): ClassifierKind {
  return useSyncExternalStore(subscribe, () => current.kind, () => current.kind);
}

/** Só para testes. */
export function setClassifierForTests(next: Classifier | null): void {
  loading = next ? Promise.resolve(next) : null;
  setCurrent(next ?? heuristic);
}
