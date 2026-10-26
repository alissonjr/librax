/**
 * Regras de leitura da câmera dos movimentos (sinais e letras com movimento): as mesmas do treino
 * (REGRAS e movimento() em ml-training/train_sinais.py e ml-training/train_letras_mov.py), lidas
 * do "reading_rules" do model.json para o treino e o app não divergirem.
 *
 * Uma janela só vira leitura quando:
 * - se mexe pelo menos minMotion (portão de movimento: mão levantada e parada não é sinal nem letra
 *   com movimento); a janela abaixo disso nem passa pelo modelo;
 * - o rótulo mais provável não é "_" e tem probabilidade >= minProbability;
 * - p("_") da janela não passa de maxNoneProbability;
 * - se o rótulo tem regra em letterRules ("letter_rules"), o desenho da janela cumpre a regra (só nas
 *   letras com movimento, letterWindowDrawing do letterMotion.ts; no treino, REGRAS_LETRAS).
 * Sem "reading_rules" (modelos de antes) vale só o limiar: minMotion 0 e maxNoneProbability 1. Sem
 * "letter_rules", nenhuma regra por letra.
 */

/** Medidas do desenho de uma janela de letra com movimento (desenho() do train_letras_mov.py). */
export type DrawingMeasure = 'displacement' | 'shapeChange' | 'shapeOscillation';

/** Limites de uma medida do desenho (min_ e max_ no model.json). */
export interface DrawingBounds {
  min?: number;
  max?: number;
}

/** Regra de uma letra: limites do desenho que a janela lida como ela precisa cumprir. */
export type LetterRule = Partial<Record<DrawingMeasure, DrawingBounds>>;

export interface ReadingRules {
  /** Probabilidade mínima do rótulo lido (min_p do treino). */
  minProbability: number;
  /** Portão de movimento (min_movimento): janela com movimento abaixo disto não é avaliada. 0 desliga. */
  minMotion: number;
  /** Peso da forma da mão no movimento (PESO_FORMA). */
  motionShapeWeight: number;
  /** Sem leitura quando p("_") da janela passa disto (max_p_nenhum). 1 desliga. */
  maxNoneProbability: number;
  /** Regras por rótulo (letter_rules, REGRAS_LETRAS do treino). Ausente: nenhuma. */
  letterRules?: Readonly<Record<string, LetterRule>>;
}

export function defaultReadingRules(minProbability: number): ReadingRules {
  return { minProbability, minMotion: 0, motionShapeWeight: 1, maxNoneProbability: 1 };
}

const FIELDS: [Exclude<keyof ReadingRules, 'letterRules'>, string][] = [
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
  if (r.letter_rules !== undefined) {
    const letterRules = letterRulesFromJson(r.letter_rules);
    if (typeof letterRules === 'string') return letterRules;
    rules.letterRules = letterRules;
  }
  return rules;
}

const MEASURES: Record<string, DrawingMeasure> = {
  displacement: 'displacement',
  shape_change: 'shapeChange',
  shape_oscillation: 'shapeOscillation',
};

/**
 * "letter_rules": {letra: {"min_shape_oscillation": 0.5, "max_displacement": 2, ...}}. Chave
 * desconhecida não serve (uma regra que o app não sabe cumprir deixaria passar o que o treino barrou).
 */
function letterRulesFromJson(raw: unknown): Record<string, LetterRule> | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'reading_rules.letter_rules não é um objeto';
  const out: Record<string, LetterRule> = {};
  for (const [label, rule] of Object.entries(raw as Record<string, unknown>)) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return `reading_rules.letter_rules.${label} não é um objeto`;
    const parsed: LetterRule = {};
    for (const [key, v] of Object.entries(rule as Record<string, unknown>)) {
      const m = /^(min|max)_(.+)$/.exec(key);
      const measure = m ? MEASURES[m[2]] : undefined;
      if (!m || !measure) return `reading_rules.letter_rules.${label}.${key} desconhecida`;
      if (typeof v !== 'number' || !Number.isFinite(v)) return `reading_rules.letter_rules.${label}.${key} inválido`;
      parsed[measure] = { ...parsed[measure], [m[1]]: v };
    }
    out[label] = parsed;
  }
  return out;
}

/** Se o desenho da janela cumpre a regra do rótulo (sem regra, cumpre). */
export function passesLetterRule(rule: LetterRule | undefined, drawing: Readonly<Record<DrawingMeasure, number>>): boolean {
  if (!rule) return true;
  for (const measure of Object.keys(rule) as DrawingMeasure[]) {
    const bounds = rule[measure]!;
    const v = drawing[measure];
    if (bounds.min !== undefined && !(v >= bounds.min)) return false;
    if (bounds.max !== undefined && !(v <= bounds.max)) return false;
  }
  return true;
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
