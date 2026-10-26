// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { comparePair, direction, fingerState, shapeDifferences, thumbState, type HintItem } from '../dicaErro/diferenca';
import { frameShape, shapeVector, signShape, toShape, type Shape, type SignShape } from '../dicaErro/forma';
import { hintPairs, hintTexts, itemText, pairHint } from '../dicaErro/dicas';
import { DICAS_REVISADAS, withReviewed } from '../dicaErro/revisadas';
import dicasJson from '../dicaErro/dicas-erro.json';
import { BONES, clonePose, positions, retarget, rigFromGlbBytes, solveCollisions } from '../mao3d/retarget';
import { sceneLandmarks } from '../mao3d/cena';
import { clipFor } from '../mao3d/poses';
import { hasHand3d, isMovingLetter } from '../mao3d/disponivel';
import ptBR from '../i18n/locales/pt-BR.json';
import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import type { TFunc } from '../i18n';

/* ---------- formas sintéticas ---------- */

const STRAIGHT = [0.1, 0.1, 0.05];
const FIST = [1.5, 1.75, 0.92];

function shape(patch: Partial<Shape> = {}): Shape {
  return {
    flex: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT].map((f) => [...f]),
    gap: [0.05, 0.05, 0.05],
    cross: 0,
    thumbTip: [0.05, 1.0, 0.3],
    thumbTouch: [0.3, 0.3, 0.4, 0.55],
    thumbTipTouch: [0.7, 0.8, 0.8, 0.7],
    thumbReach: 0.3,
    thumbFront: 0.3,
    thumbOverFingers: 0.2,
    point: [0, 1, 0],
    face: [0, 0, 1],
    ...patch,
  };
}
const zero = toShape(shapeVector(shape()).map(() => 0));
const sign = (mean: Shape, moving = false, sd: Shape = zero): SignShape => ({ mean, sd, people: 3, moving });

describe('dica de erro: estados da mão', () => {
  it('dedo esticado, curvado e dobrado', () => {
    expect(fingerState(STRAIGHT)).toBe('esticado');
    expect(fingerState([0.3, 0.6, 0.35])).toBe('curvado');
    expect(fingerState([1.06, 1.41, 0.82])).toBe('curvado'); // gancho do X
    expect(fingerState(FIST)).toBe('dobrado');
  });

  it('onde fica o polegar', () => {
    expect(thumbState(shape({ thumbTipTouch: [0.25, 0.2, 0.3, 0.5] })).v).toBe('tocaPontas');
    expect(thumbState(shape({ thumbTipTouch: [1, 0.25, 0.5, 0.6] }))).toEqual({ v: 'tocaPonta', d: 'middle' });
    expect(thumbState(shape({ thumbTouch: [0.3, 0.18, 0.4, 0.6] }))).toEqual({ v: 'encosta', d: 'middle' });
    const fist = shape({ flex: [FIST, FIST, FIST, FIST].map((f) => [...f]) });
    expect(thumbState({ ...fist, thumbTouch: [0.22, 0.4, 0.6, 0.8], thumbTip: [0.22, 1, 0.6] }).v).toBe('aoLado');
    expect(thumbState({ ...fist, thumbTouch: [0.3, 0.18, 0.3, 0.5], thumbTip: [-0.07, 0.9, 0.5], thumbOverFingers: 0.1 }).v).toBe('porCima');
    expect(thumbState({ ...fist, thumbTouch: [0.3, 0.18, 0.3, 0.5], thumbTip: [-0.07, 0.9, 0.5], thumbOverFingers: -0.1 }).v).toBe('porBaixo');
    expect(thumbState(shape({ thumbTouch: [0.8, 0.9, 1, 1.2], thumbTip: [0.7, 0.8, 0.2] })).v).toBe('lado');
    expect(thumbState(shape({ thumbTouch: [0.9, 0.9, 1, 1], thumbTip: [0.1, 0.7, 0.9], thumbFront: 0.9 })).v).toBe('frente');
    expect(thumbState(shape({ thumbTouch: [0.33, 0.47, 0.7, 0.9] })).v).toBe('dobrado');
  });

  it('para onde a mão aponta', () => {
    expect(direction([0, 1, 0])).toBe('cima');
    expect(direction([0.3, -0.7, 0.6])).toBe('baixo');
    expect(direction([0, -0.2, 0.97])).toBe('frente');
    expect(direction([0.9, 0.2, 0.3])).toBe('lado');
  });

  it('forma de um quadro: palma no referencial, polegar e dedos (pontos sintéticos)', () => {
    // Mão de pé, palma para quem olha: pulso na origem, base do médio em (0, 1, 0)
    const j: number[][] = Array.from({ length: 21 }, () => [0, 0, 0]);
    const finger = (base: number, x: number) => {
      for (let k = 0; k < 4; k++) j[base + k] = [x, 1 + 0.35 * k, 0];
    };
    finger(5, 0.3); finger(9, 0.05); finger(13, -0.15); finger(17, -0.32);
    j[1] = [0.2, 0.3, 0]; j[2] = [0.45, 0.5, 0]; j[3] = [0.6, 0.7, 0]; j[4] = [0.75, 0.85, 0];
    const s = frameShape({ joints: j.flat(), flex: [STRAIGHT, STRAIGHT, STRAIGHT, STRAIGHT], cross: 0 });
    expect(s.point[1]).toBeCloseTo(1, 1);
    expect(s.thumbTip[0]).toBeGreaterThan(0.5); // para o lado do indicador
    expect(thumbState(s).v).toBe('lado');
    expect(s.gap[0]).toBeLessThan(0.05); // dedos paralelos
  });
});

describe('dica de erro: diferença entre dois sinais', () => {
  it('dedos juntos e separados (U e V)', () => {
    const u = sign(shape({ gap: [0.05, 0.05, 0.05] }));
    const v = sign(shape({ gap: [0.3, 0.05, 0.05] }));
    expect(comparePair(u, v)).toEqual({ d: ['index', 'middle'], i: [{ k: 'abertura', d: ['index', 'middle'], v: 'juntos' }] });
    expect(comparePair(v, u).i).toEqual([{ k: 'abertura', d: ['index', 'middle'], v: 'separados' }]);
  });

  it('um dedo que muda vira o estado dele no sinal pedido; a variação entre as pessoas segura a nota', () => {
    const a = shape();
    const b = shape({ flex: [FIST, STRAIGHT, STRAIGHT, STRAIGHT].map((f) => [...f]) });
    expect(comparePair(sign(a), sign(b))).toEqual({ d: ['index'], i: [{ k: 'dedo', d: 'index', v: 'esticado' }] });
    expect(comparePair(sign(b), sign(a)).i).toEqual([{ k: 'dedo', d: 'index', v: 'dobrado' }]);
    // Pessoas muito diferentes entre si no mesmo sinal: a mesma diferença não basta
    const noisy = toShape(shapeVector(zero).map(() => 3));
    expect(comparePair(sign(a, false, noisy), sign(b, false, noisy)).i).toEqual([]);
  });

  it('dois dedos que mudam do mesmo jeito viram uma frase; três ou quatro, um grupo', () => {
    const two = shape({ flex: [STRAIGHT, STRAIGHT, FIST, FIST].map((f) => [...f]) });
    expect(comparePair(sign(shape()), sign(two)).i).toEqual([{ k: 'dedos', d: ['ring', 'pinky'], v: 'esticado' }]);
    const curved = [0.5, 1.2, 0.8];
    const many = shape({ flex: [curved, curved, curved, curved].map((f) => [...f]) });
    const diffs = shapeDifferences(sign(many), sign(shape()));
    expect(diffs[0].item).toEqual({ k: 'dedos', d: ['index', 'middle', 'ring', 'pinky'], v: 'curvado' });
  });

  it('cruzados (R e U) e direção (P e K)', () => {
    expect(comparePair(sign(shape({ cross: 0.9 })), sign(shape())).i).toEqual([{ k: 'cruzados', v: 'cruzados' }]);
    expect(comparePair(sign(shape()), sign(shape({ cross: 0.9 }))).i).toEqual([{ k: 'cruzados', v: 'ladoALado' }]);
    const side = sign(shape({ point: [0.9, 0.2, 0.38] }));
    expect(comparePair(side, sign(shape())).i).toEqual([{ k: 'direcao', v: 'lado' }]);
  });

  it('mesma forma: a diferença é o movimento (C e Ç, I e J, H e K)', () => {
    expect(comparePair(sign(shape()), sign(shape(), true)).i).toEqual([{ k: 'movimento', v: 'pedidoParado' }]);
    expect(comparePair(sign(shape(), true), sign(shape())).i).toEqual([{ k: 'movimento', v: 'pedidoMove' }]);
    expect(comparePair(sign(shape(), true), sign(shape(), true)).i).toEqual([{ k: 'movimento', v: 'outroMovimento' }]);
    // Sem movimento nenhum e sem diferença: nada a dizer (a tela pede para comparar as mãos)
    expect(comparePair(sign(shape()), sign(shape())).i).toEqual([]);
  });

  it('no máximo dois itens, o segundo só se for perto do primeiro', () => {
    const a = shape({ flex: [FIST, STRAIGHT, STRAIGHT, STRAIGHT].map((f) => [...f]), cross: 0 });
    const b = shape({ cross: 0.9, point: [0.9, 0.2, 0.38] });
    const d = comparePair(sign(a), sign(b));
    expect(d.i.length).toBeLessThanOrEqual(2);
    expect(d.i.length).toBeGreaterThan(0);
  });
});

/* ---------- a descrição conferida de cada sinal pedido ---------- */

/*
 * Configuração de mão de signs.json (params.CM, conferida no INES e no VLibras), dedo a dedo
 * [indicador, médio, anelar, mínimo]: E estendido, C curvado, F fechado (dobrado). `polegar`: onde a
 * dica pode dizer que o polegar fica (sem a chave, a descrição não diz). Uma dica do par "pedido>lido"
 * descreve o sinal pedido, então tem de caber nesta descrição.
 */
type Dedo = 'E' | 'C' | 'F';
const LONG = ['index', 'middle', 'ring', 'pinky'];
const ESTADOS: Record<Dedo, string[]> = {
  E: ['esticado', 'maisEsticado'],
  C: ['curvado', 'maisDobrado', 'maisEsticado'],
  F: ['dobrado', 'maisDobrado'],
};
interface Cm { cm: string; dedos: Dedo[]; polegar?: string[]; cruzados?: boolean; abertura?: 'juntos' | 'separados' }
const CM: Record<string, Cm> = {
  '4': { cm: 'Indicador, médio, anelar e mínimo estendidos e separados; polegar dobrado sobre a palma', dedos: ['E', 'E', 'E', 'E'], polegar: ['dobrado', 'porCima'], abertura: 'separados' },
  B: { cm: 'Dedos estendidos e juntos, polegar dobrado sobre a palma', dedos: ['E', 'E', 'E', 'E'], polegar: ['dobrado', 'porCima'], abertura: 'juntos' },
  C: { cm: 'Mão semiaberta curvada em forma de C', dedos: ['C', 'C', 'C', 'C'], polegar: ['frente', 'lado'] },
  Ç: { cm: 'Mão semiaberta curvada em forma de C (a mesma do C)', dedos: ['C', 'C', 'C', 'C'], polegar: ['frente', 'lado'] },
  D: { cm: 'Indicador estendido para cima, demais dedos curvados tocando o polegar', dedos: ['E', 'C', 'C', 'C'], polegar: ['tocaPontas', 'tocaPonta:middle', 'encosta:middle'] },
  E: { cm: 'Todos os dedos curvados sobre a palma, polegar dobrado', dedos: ['C', 'C', 'C', 'C'], polegar: ['dobrado', 'porBaixo'] },
  F: { cm: 'Indicador esticado na horizontal, apontando para o lado, polegar encostado embaixo dele; médio, anelar e mínimo estendidos', dedos: ['E', 'E', 'E', 'E'], polegar: ['encosta:index', 'porBaixo'] },
  G: { cm: 'Indicador estendido para cima, polegar esticado e afastado do indicador; médio, anelar e mínimo fechados', dedos: ['E', 'F', 'F', 'F'], polegar: ['lado', 'frente'] },
  H: { cm: 'Indicador esticado para cima, médio esticado para frente, polegar encostado no médio; anelar e mínimo fechados', dedos: ['E', 'E', 'F', 'F'], polegar: ['encosta:middle'] },
  I: { cm: 'Só o mínimo estendido para cima, demais dedos dobrados', dedos: ['F', 'F', 'F', 'E'] },
  J: { cm: 'Mínimo estendido (a mão do I)', dedos: ['F', 'F', 'F', 'E'] },
  K: { cm: 'Indicador esticado para cima, médio esticado para frente, polegar encostado no médio; anelar e mínimo fechados', dedos: ['E', 'E', 'F', 'F'], polegar: ['encosta:middle', 'encosta:index'] },
  L: { cm: 'Indicador aponta para cima, polegar estendido para o lado em ângulo de 90 graus', dedos: ['E', 'F', 'F', 'F'], polegar: ['lado'] },
  O: { cm: 'Todos os dedos curvados formando O fechado com o polegar', dedos: ['C', 'C', 'C', 'C'], polegar: ['tocaPontas', 'tocaPonta:index', 'tocaPonta:middle'] },
  P: { cm: 'Indicador e médio esticados e separados, polegar encostado no médio; anelar e mínimo fechados', dedos: ['E', 'E', 'F', 'F'], polegar: ['encosta:middle'], abertura: 'separados' },
  R: { cm: 'Indicador e médio cruzados, apontando para cima', dedos: ['E', 'E', 'F', 'F'], cruzados: true },
  T: { cm: 'Indicador curvado com a ponta tocando a ponta do polegar; médio, anelar e mínimo estendidos', dedos: ['C', 'E', 'E', 'E'], polegar: ['tocaPonta:index', 'tocaPontas'] },
  U: { cm: 'Indicador e médio estendidos juntos, apontando para cima', dedos: ['E', 'E', 'F', 'F'], abertura: 'juntos' },
  V: { cm: 'Indicador e médio estendidos em V aberto, demais dobrados', dedos: ['E', 'E', 'F', 'F'], abertura: 'separados' },
  X: { cm: 'Indicador dobrado em gancho, demais dedos dobrados', dedos: ['C', 'F', 'F', 'F'] },
  Z: { cm: 'Indicador estendido (traça o Z)', dedos: ['E', 'F', 'F', 'F'] },
};

/* ---------- os dados gerados ---------- */

type Fs = { readFileSync(path: URL): Uint8Array };
let rig: ReturnType<typeof rigFromGlbBytes>;
beforeAll(async () => {
  const fs = (await import(/* @vite-ignore */ 'node:fs' as string)) as Fs;
  rig = rigFromGlbBytes(fs.readFileSync(new URL('../mao3d/mao-3d.glb', import.meta.url)));
});

const ORDEM_MP: string[] = [
  'wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((d) => [`${d}_mcp`, `${d}_pip`, `${d}_dip`, `${d}_tip`]),
];

/** O mesmo caminho do script: mão desenhada -> forma -> média do sinal. */
function signFromClip(g: string): SignShape {
  const clip = clipFor(g)!;
  const idx = ORDEM_MP.map((n) => (BONES as readonly string[]).indexOf(n));
  return signShape(
    clip.people.map((p) => p.frames.map((q) => {
      const pose = clonePose(retarget(rig, sceneLandmarks((i) => q[i * 3], (i) => q[i * 3 + 1], (i) => q[i * 3 + 2])));
      const pos = positions(rig, solveCollisions(rig, pose));
      return frameShape({
        joints: idx.flatMap((k) => [pos[k].x / rig.palmLen, pos[k].y / rig.palmLen, pos[k].z / rig.palmLen]),
        flex: pose.flex,
        cross: pose.cross,
      });
    })),
    clip.moving,
  );
}

function lookup(dict: unknown, key: string): string | undefined {
  const v = key.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), dict);
  return typeof v === 'string' ? v : undefined;
}
const tFor = (dict: unknown): TFunc => (key, params) => {
  const s = lookup(dict, key);
  if (s === undefined) throw new Error(`sem tradução: ${key}`);
  return s.replace(/\{(\w+)\}/g, (m, n: string) => (params && n in params ? String(params[n]) : m));
};

describe('dica de erro: dicas-erro.json', () => {
  it('tem os pares do plano de lições e os de mesma forma com e sem movimento', () => {
    for (const k of ['K>H', 'P>K', 'R>U', 'F>T', 'T>F', 'X>H', 'X>N', 'C>Ç', 'Ç>C', 'I>J', 'J>I']) expect(hintPairs()).toContain(k);
    expect(pairHint('K', 'H')?.i).toEqual([{ k: 'movimento', v: 'outroMovimento' }]);
    expect(pairHint('C', 'Ç')?.i).toEqual([{ k: 'movimento', v: 'pedidoParado' }]);
    expect(pairHint('R', 'U')?.i[0]).toEqual({ k: 'cruzados', v: 'cruzados' });
    expect(pairHint('U', 'V')?.i[0]).toEqual({ k: 'abertura', d: ['index', 'middle'], v: 'juntos' });
    expect(pairHint('A', 'Z')).toBeNull();
  });

  it('cada par: os dois sinais têm mão em 3D, da mesma categoria; dedos destacados são os dos itens', () => {
    for (const k of hintPairs()) {
      const [a, b] = k.split('>');
      const cat = (g: string) => (/^\d$/.test(g) ? 'numeros' : 'alfabeto');
      expect(cat(a), k).toBe(cat(b));
      expect(hasHand3d({ category: cat(a), gloss: a }), k).toBe(true);
      expect(hasHand3d({ category: cat(b), gloss: b }), k).toBe(true);
      const d = pairHint(a, b)!;
      expect(d.i.length, k).toBeLessThanOrEqual(2);
      // Movimento só onde uma das duas letras tem movimento
      if (d.i.some((it) => it.k === 'movimento')) expect(isMovingLetter(a) || isMovingLetter(b), k).toBe(true);
    }
  });

  it('está em dia com as poses (o mesmo cálculo do script)', () => {
    const cache = new Map<string, SignShape>();
    const get = (g: string) => cache.get(g) ?? cache.set(g, signFromClip(g)).get(g)!;
    for (const k of hintPairs()) {
      const [a, b] = k.split('>');
      // calculada nas poses, ou a revisada à mão quando a calculada contradiz a descrição (revisadas.ts)
      const { d, i } = withReviewed(k, comparePair(get(a), get(b)));
      expect({ d, i }, k).toEqual({ d: pairHint(a, b)!.d, i: pairHint(a, b)!.i });
    }
  }, 30000);

  it('os pares revisados à mão estão no JSON com a dica revisada', () => {
    const raw = dicasJson.dicas as Record<string, { rev?: boolean }>;
    for (const [k, r] of Object.entries(DICAS_REVISADAS)) {
      expect(hintPairs(), k).toContain(k);
      expect(pairHint(...(k.split('>') as [string, string]))!.i, k).toEqual(r.i);
      expect(raw[k].rev, k).toBe(true);
      expect(r.porque, k).toMatch(/"/); // cita a descrição conferida
    }
    for (const [k, v] of Object.entries(raw)) if (v.rev) expect(DICAS_REVISADAS[k], k).toBeDefined();
    // O caso que motivou a revisão: o F tem o indicador esticado e o polegar encostado embaixo dele
    expect(hintTexts(tFor(ptBR), 'F', 'T', 'letter').line)
      .toBe('Diferença: o indicador fica esticado e o polegar encosta no indicador');
    expect(hintTexts(tFor(ptBR), 'T', 'F', 'letter').line)
      .toBe('Diferença: o indicador fica curvado e o polegar toca a ponta do indicador');
  });

  it('nenhuma dica contradiz a configuração de mão conferida do sinal pedido (signs.json)', () => {
    for (const k of hintPairs()) {
      const [asked] = k.split('>');
      const cm = CM[asked];
      expect(cm, `${k}: falta a descrição de ${asked} na tabela CM do teste`).toBeDefined();
      for (const it of pairHint(...(k.split('>') as [string, string]))!.i) {
        const fingers = it.k === 'dedo' ? [it.d] : it.k === 'dedos' ? it.d : [];
        for (const f of fingers) {
          const v = (it as { v: string }).v;
          expect(ESTADOS[cm.dedos[LONG.indexOf(f)]], `${k}: ${f} ${v} contradiz "${cm.cm}"`).toContain(v);
        }
        if (it.k === 'polegar' && cm.polegar) {
          expect(cm.polegar, `${k}: polegar ${it.v} contradiz "${cm.cm}"`).toContain(it.d ? `${it.v}:${it.d}` : it.v);
        }
        if (it.k === 'cruzados') expect(it.v === 'cruzados', `${k}: contradiz "${cm.cm}"`).toBe(!!cm.cruzados);
        if (it.k === 'abertura' && cm.abertura) expect(it.v, `${k}: contradiz "${cm.cm}"`).toBe(cm.abertura);
      }
    }
  });

  it('cada item tem texto nos três idiomas, sem travessão e sem chave faltando', () => {
    const items = new Map<string, HintItem>();
    for (const k of hintPairs()) for (const it of pairHint(...(k.split('>') as [string, string]))!.i) items.set(JSON.stringify(it), it);
    for (const dict of [ptBR, en, es]) {
      const t = tFor(dict);
      for (const it of items.values()) {
        const s = itemText(t, it, 'K', 'letter');
        expect(s).not.toMatch(/\{|\}|wrongHint|[\u2013\u2014]/);
      }
      for (const k of hintPairs()) {
        const [a, b] = k.split('>');
        const texts = hintTexts(t, a, b, /^\d$/.test(a) ? 'number' : 'letter');
        expect(texts.line).not.toMatch(/[\u2013\u2014{}]/);
        expect(texts.spoken).toContain(b);
      }
    }
  });

  it('frase da dica e do leitor de tela', () => {
    const t = tFor(ptBR);
    expect(hintTexts(t, 'K', 'H', 'letter')).toEqual({
      line: 'Diferença: o K tem outro movimento',
      spoken: 'A câmera viu o H. Você precisa fazer o K: o K tem outro movimento.',
      movement: true,
    });
    expect(hintTexts(t, 'U', 'V', 'letter').line).toBe('Diferença: o indicador e o médio ficam juntos');
    expect(hintTexts(t, 'A', 'Z', 'letter')).toEqual({
      line: 'Compare as duas mãos.',
      spoken: 'A câmera viu o Z. Você precisa fazer o A.',
      movement: false,
    });
    expect(hintTexts(tFor(es), 'C', 'Ç', 'letter').line).toBe('Diferencia: la C no tiene movimiento');
    expect(hintTexts(tFor(en), 'R', 'U', 'letter').line).toBe('Difference: the index and middle fingers are crossed');
  });
});
