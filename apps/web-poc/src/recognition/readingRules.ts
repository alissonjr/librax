/**
 * Regras de leitura da câmera dos movimentos (sinais e letras com movimento): as mesmas do treino
 * (REGRAS e movimento() em ml-training/train_sinais.py e ml-training/train_letras_mov.py), lidas
 * do "reading_rules" do model.json para o treino e o app não divergirem.
 *
 * Uma janela só vira leitura quando:
 * - se mexe pelo menos minMotion (portão de movimento: mão levantada e parada não é sinal nem letra
 *   com movimento); a janela abaixo disso nem passa pelo modelo;
 * - o rótulo mais provável não é "_" e tem probabilidade >= minProbability;
 * - p("_") da janela não passa de maxNoneProbability.
 * Sem "reading_rules" (modelos de antes) vale só o limiar: minMotion 0 e maxNoneProbability 1.
 */

export interface ReadingRules {
  /** Probabilidade mínima do rótulo lido (min_p do treino). */
  minProbability: number;
  /** Portão de movimento (min_movimento): janela com movimento abaixo disto não é avaliada. 0 desliga. */
  minMotion: number;
  /** Peso da forma da mão no movimento (PESO_FORMA). */
  motionShapeWeight: number;
  /** Sem leitura quando p("_") da janela passa disto (max_p_nenhum). 1 desliga. */
  maxNoneProbability: number;
}

export function defaultReadingRules(minProbability: number): ReadingRules {
  return { minProbability, minMotion: 0, motionShapeWeight: 1, maxNoneProbability: 1 };
}

const FIELDS: [keyof ReadingRules, string][] = [
  ['minProbability', 'min_probability'],
  ['minMotion', 'min_motion'],
  ['motionShapeWeight', 'motion_shape_weight'],
  ['maxNoneProbability', 'max_none_probability'],
];

/**
 * Regras do "reading_rules" do model.json (campo ausente fica com o padrão). Devolve o motivo
 * (texto) quando o campo existe mas não serve.
 */
export function readingRulesFromJson(json: unknown, minProbability: number): ReadingRules | string {
  const rules = defaultReadingRules(minProbability);
  const raw = (json as Record<string, unknown> | null)?.reading_rules;
  if (raw === undefined) return rules;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'reading_rules não é um objeto';
  const r = raw as Record<string, unknown>;
  for (const [key, name] of FIELDS) {
    const v = r[name];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return `reading_rules.${name} inválido`;
    rules[key] = v;
  }
  if (rules.minProbability > 1 || rules.maxNoneProbability > 1) return 'reading_rules com probabilidade acima de 1';
  return rules;
}

/** Onde ficam, em cada passo da entrada, a presença, o pulso (x, y) e a forma de uma mão. */
export interface MotionSlot {
  presence: number;
  wrist: number;
  /** Primeiro e último (exclusivo) atributos da forma: os 65 da normalizeHand. */
  shape: [number, number];
}

/**
 * Movimento de uma janela (entrada do modelo: `steps` passos de `stepDim` atributos). Em cada vaga
 * de mão, entre dois passos quaisquer com a mão: a distância do pulso mais shapeWeight vezes a
 * distância da forma dividida por raiz de 21; vale o maior valor das vagas. Vaga com a mão em
 * menos de dois passos conta 0. É o movimento() do treino.
 */
export function windowMotion(
  input: ArrayLike<number>, steps: number, stepDim: number, slots: readonly MotionSlot[], shapeWeight: number,
): number {
  let best = 0;
  const root21 = Math.sqrt(21);
  for (const s of slots) {
    for (let i = 0; i < steps; i++) {
      const a = i * stepDim;
      if (!(input[a + s.presence] > 0.5)) continue;
      for (let j = i + 1; j < steps; j++) {
        const b = j * stepDim;
        if (!(input[b + s.presence] > 0.5)) continue;
        const dx = input[b + s.wrist] - input[a + s.wrist];
        const dy = input[b + s.wrist + 1] - input[a + s.wrist + 1];
        let shape = 0;
        for (let k = s.shape[0]; k < s.shape[1]; k++) {
          const d = input[b + k] - input[a + k];
          shape += d * d;
        }
        const value = Math.hypot(dx, dy) + (shapeWeight * Math.sqrt(shape)) / root21;
        if (value > best) best = value;
      }
    }
  }
  return best;
}
