/**
 * MLP em TypeScript puro para as letras estáticas (decisão 6 do plano mobile web).
 *
 * Lê o que o ml-training/train_static.py exporta:
 * - model.json: formas das camadas, ativações, rótulos e normalization_version;
 * - weights.bin: float32 little-endian; para cada camada, a matriz [entrada][saída] linha a
 *   linha e depois o bias [saída].
 * Dropout só existe no treino, então aqui não aparece.
 */

export type Activation = 'relu' | 'softmax' | 'linear';

export interface MlpLayerSpec {
  in: number;
  out: number;
  activation: Activation;
}

export interface MlpModelJson {
  format: 'librax-mlp';
  format_version: 1;
  normalization_version: number;
  input_dim: number;
  labels: string[];
  layers: MlpLayerSpec[];
  weights: { file: string; dtype: 'float32'; byte_length: number };
  [extra: string]: unknown;
}

export interface MlpLayer extends MlpLayerSpec {
  /** [in][out] linha a linha. */
  kernel: Float32Array;
  bias: Float32Array;
}

export interface MlpModel {
  labels: string[];
  normalizationVersion: number;
  inputDim: number;
  layers: MlpLayer[];
}

export class MlpFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MlpFormatError';
  }
}

const ACTIVATIONS: Activation[] = ['relu', 'softmax', 'linear'];

/** Valida o model.json e corta o weights.bin em camadas. Lança MlpFormatError se não bater. */
export function parseMlp(json: unknown, weights: ArrayBuffer): MlpModel {
  const m = json as Partial<MlpModelJson> | null;
  if (!m || m.format !== 'librax-mlp' || m.format_version !== 1) {
    throw new MlpFormatError('model.json não é um librax-mlp versão 1');
  }
  if (!Array.isArray(m.labels) || m.labels.length === 0) throw new MlpFormatError('sem labels');
  if (!Array.isArray(m.layers) || m.layers.length === 0) throw new MlpFormatError('sem camadas');
  if (typeof m.input_dim !== 'number' || typeof m.normalization_version !== 'number') {
    throw new MlpFormatError('input_dim ou normalization_version ausente');
  }

  let expectedIn = m.input_dim;
  let totalFloats = 0;
  for (const l of m.layers) {
    if (l.in !== expectedIn) throw new MlpFormatError(`camada espera ${l.in} entradas, recebe ${expectedIn}`);
    if (!ACTIVATIONS.includes(l.activation)) throw new MlpFormatError(`ativação desconhecida: ${l.activation}`);
    totalFloats += l.in * l.out + l.out;
    expectedIn = l.out;
  }
  if (expectedIn !== m.labels.length) throw new MlpFormatError('a última camada não tem uma saída por label');
  if (weights.byteLength !== totalFloats * 4) {
    throw new MlpFormatError(`weights.bin tem ${weights.byteLength} bytes, esperado ${totalFloats * 4}`);
  }

  // DataView garante little-endian em qualquer aparelho
  const view = new DataView(weights);
  let offset = 0;
  const read = (n: number) => {
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++, offset += 4) arr[i] = view.getFloat32(offset, true);
    return arr;
  };
  const layers = m.layers.map(l => {
    const kernel = read(l.in * l.out);
    const bias = read(l.out);
    return { in: l.in, out: l.out, activation: l.activation, kernel, bias };
  });

  return { labels: [...m.labels], normalizationVersion: m.normalization_version, inputDim: m.input_dim, layers };
}

/** Forward pass. Devolve as probabilidades (softmax) na ordem de `model.labels`. */
export function predict(model: MlpModel, input: ArrayLike<number>): Float64Array {
  if (input.length !== model.inputDim) {
    throw new MlpFormatError(`entrada com ${input.length} valores, o modelo espera ${model.inputDim}`);
  }
  let x: ArrayLike<number> = input;
  for (const layer of model.layers) {
    const y = new Float64Array(layer.out);
    for (let j = 0; j < layer.out; j++) y[j] = layer.bias[j];
    for (let i = 0; i < layer.in; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const row = i * layer.out;
      for (let j = 0; j < layer.out; j++) y[j] += xi * layer.kernel[row + j];
    }
    if (layer.activation === 'relu') {
      for (let j = 0; j < y.length; j++) if (y[j] < 0) y[j] = 0;
    } else if (layer.activation === 'softmax') {
      softmaxInPlace(y);
    }
    x = y;
  }
  return x as Float64Array;
}

function softmaxInPlace(y: Float64Array): void {
  let max = -Infinity;
  for (const v of y) if (v > max) max = v;
  let sum = 0;
  for (let j = 0; j < y.length; j++) { y[j] = Math.exp(y[j] - max); sum += y[j]; }
  for (let j = 0; j < y.length; j++) y[j] /= sum;
}

export interface MlpClassification {
  label: string;
  probability: number;
  probs: Float64Array;
}

export function classify(model: MlpModel, input: ArrayLike<number>): MlpClassification {
  const probs = predict(model, input);
  let best = 0;
  for (let j = 1; j < probs.length; j++) if (probs[j] > probs[best]) best = j;
  return { label: model.labels[best], probability: probs[best], probs };
}
