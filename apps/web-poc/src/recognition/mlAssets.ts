/**
 * Onde ficam os arquivos de ML servidos pelo próprio app (seção 3.1 do plano mobile web).
 * scripts/ml-assets.mjs copia o WASM do pacote e o modelo para public/ml/<versão>/.
 * A versão precisa ser igual à do @mediapipe/tasks-vision no package.json (fixada sem ^);
 * o teste mlAssets.test.ts confere isso.
 */
export const MEDIAPIPE_VERSION = '1.1.1';

export const ML_BASE = `/ml/${MEDIAPIPE_VERSION}`;
/** Pasta passada ao FilesetResolver (ele escolhe o WASM com ou sem SIMD). */
export const MEDIAPIPE_WASM_DIR = `${ML_BASE}/wasm`;
export const HAND_MODEL_URL = `${ML_BASE}/hand_landmarker.task`;
/** WASM que os navegadores-alvo usam (Safari 16.4+ e Chrome têm SIMD). */
export const MEDIAPIPE_WASM_URL = `${MEDIAPIPE_WASM_DIR}/vision_wasm_internal.wasm`;

/** Classificador treinado (model.json + weights.bin). Se não existir, vale o heurístico. */
export const CLASSIFIER_DIR = '/ml/classifier';
