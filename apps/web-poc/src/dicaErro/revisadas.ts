/*
 * Dicas revisadas à mão: pares em que a diferença calculada nas poses da mão em 3D contradiz a
 * configuração de mão conferida (signs.json, params.CM, conferida no INES e no VLibras). As poses
 * vêm de vídeos de pessoas reais, e nesses pares a média delas não bate com a descrição: o F das
 * pessoas aparece com o indicador dobrado, o J com o mínimo curvando durante o traço e o Ç (a mão
 * do C) com o anelar e o mínimo quase retos. A dica segue a descrição conferida.
 *
 * O script (scripts/gerar-dicas-erro.ts) grava estas no lugar da calculada, e o teste
 * (dicaErroDiferenca.test.ts) falha se o dicas-erro.json disser outra coisa para estes pares ou se
 * qualquer dica contradisser a descrição de mão do sinal pedido.
 */
import { digitsOf, type HintItem, type PairDiff } from './diferenca';
import { DIGITS } from './forma';

interface Revisada {
  i: HintItem[];
  /** Por que, com a descrição conferida (signs.json). */
  porque: string;
}

const C_CURVADA = 'Ç: "Mão semiaberta curvada em forma de C (a mesma do C)": os quatro dedos curvados, nenhum esticado.';
const J_MINIMO = 'J: "Mínimo estendido" (a mão do I: só o mínimo estendido, demais dedos dobrados), traçando o J.';
const QUATRO_CURVADOS: HintItem = { k: 'dedos', d: ['index', 'middle', 'ring', 'pinky'], v: 'curvado' };

export const DICAS_REVISADAS: Record<string, Revisada> = {
  'F>T': {
    i: [{ k: 'dedo', d: 'index', v: 'esticado' }, { k: 'polegar', v: 'encosta', d: 'index' }],
    porque: 'F: "Indicador esticado na horizontal, apontando para o lado, polegar encostado embaixo dele"; '
      + 'T: "Indicador curvado com a ponta tocando a ponta do polegar". O calculado dizia indicador dobrado e polegar ao lado.',
  },
  'T>F': {
    i: [{ k: 'dedo', d: 'index', v: 'curvado' }, { k: 'polegar', v: 'tocaPonta', d: 'index' }],
    porque: 'T: "Indicador curvado com a ponta tocando a ponta do polegar". O calculado dizia "o polegar encosta no '
      + 'indicador", que é o polegar do F ("encostado embaixo dele").',
  },
  'G>L': {
    i: [],
    porque: 'G: "polegar esticado e afastado do indicador"; L: "polegar estendido para o lado em ângulo de 90 graus". '
      + 'O calculado dizia polegar dobrado; o vocabulário não tem a diferença de ângulo, então a dica pede para comparar.',
  },
  'Ç>H': { i: [QUATRO_CURVADOS], porque: `${C_CURVADA} O calculado dizia anelar e mínimo esticados.` },
  'Ç>J': { i: [QUATRO_CURVADOS], porque: `${C_CURVADA} O calculado dizia anelar esticado.` },
  'Ç>K': { i: [QUATRO_CURVADOS], porque: `${C_CURVADA} O calculado dizia anelar e mínimo esticados.` },
  'Ç>X': { i: [QUATRO_CURVADOS], porque: `${C_CURVADA} O calculado dizia anelar e mínimo esticados.` },
  'Ç>Z': { i: [QUATRO_CURVADOS], porque: `${C_CURVADA} O calculado dizia anelar esticado.` },
  'J>H': {
    i: [{ k: 'dedo', d: 'index', v: 'dobrado' }, { k: 'dedo', d: 'pinky', v: 'esticado' }],
    porque: `${J_MINIMO} O calculado dizia mínimo curvado.`,
  },
  'J>K': {
    i: [{ k: 'dedo', d: 'index', v: 'dobrado' }, { k: 'dedo', d: 'pinky', v: 'esticado' }],
    porque: `${J_MINIMO} O calculado dizia mínimo curvado.`,
  },
  'J>X': { i: [{ k: 'dedo', d: 'pinky', v: 'esticado' }], porque: `${J_MINIMO} O calculado dizia mínimo curvado.` },
  'J>Z': {
    i: [{ k: 'dedo', d: 'index', v: 'dobrado' }, { k: 'dedo', d: 'pinky', v: 'esticado' }],
    porque: `${J_MINIMO} O calculado dizia mínimo curvado.`,
  },
};

/** Dedos a destacar de uma lista de itens (a mesma ordem do comparePair). */
export function digitsFor(items: readonly HintItem[]): PairDiff['d'] {
  return DIGITS.filter((g) => items.some((it) => digitsOf(it).includes(g)));
}

/**
 * A dica do par: a revisada, se houver, senão a calculada. Revisada sem itens destaca os dedos que a
 * calculada destacava (a tela pede para comparar as mãos).
 */
export function withReviewed(pair: string, computed: PairDiff): PairDiff {
  const r = DICAS_REVISADAS[pair];
  if (!r) return computed;
  return { d: r.i.length ? digitsFor(r.i) : computed.d, i: r.i.map((it) => ({ ...it })) };
}
