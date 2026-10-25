import { predict, type MlpModel } from './mlp';
import {
  compactWindow, dominantHand, frameFeatures, hasRaisedHand, resampleWindow, type SignFrame,
} from './signFeatures';
import { NO_SIGN_LABEL, SIGN_MIN_PROBABILITY } from './signModel';

/**
 * Reconhecedor dos sinais com movimento ao vivo.
 *
 * Guarda os últimos BUFFER_S segundos de quadros (mãos e corpo, com o tempo) e, quando chamado
 * (algumas vezes por segundo: a câmera chama a cada EVAL_MS), avalia as janelas de 1, 1,5 e 2 s
 * que terminam no quadro mais recente, as mesmas durações das janelas do treino. Cada janela passa
 * pelo MLP; vale a leitura de sinal (não "_") com probabilidade >= 0,6 mais alta entre elas.
 *
 * Mão dominante: no treino (mao_dominante do rotular_sinais.py) é a que mais se mexe no vídeo
 * inteiro, que tem introdução, fala e o sinal. Ao vivo não há vídeo inteiro, então vale a que
 * mais se mexe no buffer (os 2,5 s mais recentes), a mesma para as três janelas. Sem movimento
 * nenhum (uma mão parada desde o começo), vale o rótulo que mais aparece no buffer, e não o "sem
 * dominante" do Python, que mandaria a mão para a vaga da outra.
 */

/** Janelas avaliadas (segundos), as do treino (JANELAS_S). */
export const SIGN_WINDOWS_S: readonly number[] = [1.0, 1.5, 2.0];
/** Quadros guardados: a janela mais longa e uma folga. */
export const BUFFER_S = 2.5;
/** Intervalo entre avaliações: o passo das janelas candidatas do treino (PASSO_S). */
export const EVAL_MS = 250;
/** Janela só é avaliada quando o buffer cobre pelo menos esta fração dela. */
const MIN_COVERAGE = 0.9;

export interface SignReading {
  /** Glosa lida (probabilidade >= SIGN_MIN_PROBABILITY e não "_"), ou null. */
  gloss: string | null;
  /** Probabilidade da glosa lida (0 sem leitura). */
  probability: number;
  /** Maior probabilidade de cada rótulo entre as janelas avaliadas, na ordem de `labels`. */
  probs: Float64Array;
  /** Janelas avaliadas (0: buffer curto ou nenhuma mão levantada). */
  windows: number;
}

export interface SignRecognizer {
  readonly labels: readonly string[];
  /** Acrescenta um quadro (tempos crescentes; quadro fora de ordem é ignorado). */
  push(frame: SignFrame, aspect: number): void;
  /** Avalia as janelas que terminam no quadro mais recente. */
  evaluate(): SignReading;
  /** Entradas do modelo de cada janela avaliável agora (usado pelo evaluate e pelos testes). */
  windowInputs(): { duration: number; input: Float64Array }[];
  /** Quadros no buffer. */
  size(): number;
  reset(): void;
}

/** Rótulo mais frequente das mãos do buffer (quando nenhuma se mexeu). */
function mostSeenHand(frames: readonly SignFrame[]): string | null {
  const count = new Map<string | null, number>();
  for (const f of frames) for (const h of f.hands) count.set(h.handedness, (count.get(h.handedness) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [label, c] of count) if (c > n) { best = label; n = c; }
  return best;
}

/** Probabilidade de `gloss` na leitura (0 se o modelo não tem a glosa). */
export function probabilityOf(reading: SignReading, labels: readonly string[], gloss: string): number {
  const i = labels.indexOf(gloss);
  return i >= 0 ? reading.probs[i] : 0;
}

export function createSignRecognizer(model: MlpModel): SignRecognizer {
  let frames: SignFrame[] = [];
  let aspect = 1;
  const none = model.labels.indexOf(NO_SIGN_LABEL);

  const windowInputs = () => {
    if (frames.length < 2) return [];
    const tEnd = frames[frames.length - 1].t;
    const span = tEnd - frames[0].t;
    const dominant = dominantHand(frames, aspect) ?? mostSeenHand(frames);
    const ts = frames.map(f => f.t);
    const feats = frames.map(f => frameFeatures(f, aspect, dominant));
    const out: { duration: number; input: Float64Array }[] = [];
    for (const duration of SIGN_WINDOWS_S) {
      if (span < duration * MIN_COVERAGE) continue;
      const t0 = tEnd - duration;
      // Janela sem mão levantada não é parecida com nada do treino (todas vêm de trechos ativos)
      const inside = feats.filter((_, i) => ts[i] >= t0);
      if (!hasRaisedHand(inside)) continue;
      out.push({ duration, input: compactWindow(resampleWindow(ts, feats, t0, tEnd)) });
    }
    return out;
  };

  return {
    labels: model.labels,
    push(frame, frameAspect) {
      const last = frames[frames.length - 1];
      if (last && frame.t <= last.t) return;
      if (Number.isFinite(frameAspect) && frameAspect > 0) aspect = frameAspect;
      frames.push(frame);
      const keepFrom = frame.t - BUFFER_S;
      let drop = 0;
      while (drop < frames.length && frames[drop].t < keepFrom) drop++;
      if (drop > 0) frames = frames.slice(drop);
    },
    windowInputs,
    evaluate() {
      const probs = new Float64Array(model.labels.length);
      let gloss: string | null = null;
      let probability = 0;
      const inputs = windowInputs();
      for (const { input } of inputs) {
        const p = predict(model, input);
        let best = 0;
        for (let j = 0; j < p.length; j++) {
          if (p[j] > probs[j]) probs[j] = p[j];
          if (p[j] > p[best]) best = j;
        }
        // Como o medir do train_sinais.py: vale o mais provável da janela, se for sinal e passar do limiar
        if (best !== none && p[best] >= SIGN_MIN_PROBABILITY && p[best] > probability) {
          gloss = model.labels[best];
          probability = p[best];
        }
      }
      return { gloss, probability, probs, windows: inputs.length };
    },
    size: () => frames.length,
    reset() {
      frames = [];
    },
  };
}
