/*
 * Gera src/dicaErro/dicas-erro.json: a diferença entre a letra (ou o número) pedida e a que a
 * câmera leu, para a dica visual dos exercícios com câmera (src/dicaErro/).
 *
 *   npx vite-node scripts/gerar-dicas-erro.ts [-- --dados=<ml-training/data>] [-- --formas]
 *
 * 1. Forma de cada sinal: as mãos de maos-licoes.json (as mesmas da mão em 3D) passam pelo mesmo
 *    retargeting e pela mesma colisão da tela (src/mao3d/retarget.ts); de cada quadro desenhado sai
 *    a forma (src/dicaErro/forma.ts) e, por sinal, a média e o desvio entre as pessoas.
 * 2. Pares que acontecem de verdade, sempre dentro da mesma categoria do cameraStats (letra com
 *    letra, número com número):
 *    - letras paradas: o classificador do app (public/ml/classifier) nos vídeos do teste fixo
 *      (ml-training/data/teste_fixo.json, canais fora do treino), quadro a quadro, como no
 *      teste_fixo.py: a letra pedida lida como outra com a probabilidade mínima do app;
 *    - números: o modelo dos números do app (public/ml/numeros) nos quadros das pessoas de teste
 *      (test_channels do model.json);
 *    - letras com movimento: todos os pares entre as letras do modelo das letras com movimento
 *      (o modelo só lê essas) e os pares de mesma forma com e sem movimento (C e Ç, I e J, D e Z);
 *    - as trocas do plano de lições (docs/plano-licoes-pos-treino.md, seção 3).
 *    Sem ml-training/data, a lista de pares do JSON anterior continua valendo.
 * 3. Cada par vira a diferença (src/dicaErro/diferenca.ts): os dedos que mudam, em palavras de um
 *    vocabulário pequeno (i18n wrongHint.*), e os dedos a destacar nas duas mãos.
 * 4. Pares em que a diferença calculada contradiz a configuração de mão conferida (signs.json) usam
 *    a dica revisada (src/dicaErro/revisadas.ts) e saem com "rev": true.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BONES, clonePose, positions, retarget, rigFromGlbBytes, solveCollisions } from '../src/mao3d/retarget';
import { sceneLandmarks } from '../src/mao3d/cena';
import { clipFor, clipGlosses } from '../src/mao3d/poses';
import { frameShape, signShape, type Shape, type SignShape } from '../src/dicaErro/forma';
import { comparePair, shapeDifferences } from '../src/dicaErro/diferenca';
import { DICAS_REVISADAS, withReviewed } from '../src/dicaErro/revisadas';
import { normalizeHand } from '../src/recognition/normalize';
import { classify, parseMlp, type MlpModel } from '../src/recognition/mlp';
import type { Lm } from '../src/lib/recognizer';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');
const RAIZ = resolve(APP, '../..');
const ARG_DADOS = process.argv.find((a) => a.startsWith('--dados='))?.slice(8);
const FORMAS = process.argv.includes('--formas');
const DADOS = [ARG_DADOS, resolve(RAIZ, 'ml-training/data'), resolve(RAIZ, '../../../ml-training/data')]
  .filter((d): d is string => !!d)
  .map((d) => resolve(d))
  .find((d) => existsSync(resolve(d, 'teste_fixo.json')) && existsSync(resolve(d, 'landmarks')));
const SAIDA = resolve(APP, 'src/dicaErro/dicas-erro.json');

/* ---------- 1. forma de cada sinal ---------- */

const rig = rigFromGlbBytes(readFileSync(resolve(APP, 'src/mao3d/mao-3d.glb')));
const ORDEM_MP: string[] = [
  'wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((d) => [`${d}_mcp`, `${d}_pip`, `${d}_dip`, `${d}_tip`]),
];
const IDX = ORDEM_MP.map((n) => (BONES as readonly string[]).indexOf(n));

function drawnShape(q: Float32Array): Shape {
  const pose = clonePose(retarget(rig, sceneLandmarks((i) => q[i * 3], (i) => q[i * 3 + 1], (i) => q[i * 3 + 2])));
  const pos = positions(rig, solveCollisions(rig, pose));
  return frameShape({
    joints: IDX.flatMap((k) => [pos[k].x / rig.palmLen, pos[k].y / rig.palmLen, pos[k].z / rig.palmLen]),
    flex: pose.flex,
    cross: pose.cross,
  });
}

const formas: Record<string, SignShape> = {};
for (const g of clipGlosses()) {
  const clip = clipFor(g)!;
  formas[g] = signShape(clip.people.map((p) => p.frames.map(drawnShape)), clip.moving);
}

if (FORMAS) {
  const r = (v: number) => Math.round(v * 100) / 100;
  for (const [g, s] of Object.entries(formas)) {
    const m = s.mean;
    console.log(
      `${g.padEnd(2)} flex ${m.flex.map((f) => f.map(r).join('/')).join('  ')} | gap ${m.gap.map(r).join('/')} x${r(m.cross)}`
      + ` | pol tip ${m.thumbTip.map(r).join(',')} toque ${m.thumbTouch.map(r).join('/')} ponta ${m.thumbTipTouch.map(r).join('/')}`
      + ` reach ${r(m.thumbReach)} frente ${r(m.thumbFront)} sobre ${r(m.thumbOverFingers)} | aponta ${m.point.map(r).join(',')} palma ${m.face.map(r).join(',')}`,
    );
  }
  process.exit(0);
}

/* ---------- 2. pares que acontecem ---------- */

const lms = (raw: readonly number[]): Lm[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] }));

function modelo(dir: string): { model: MlpModel; json: Record<string, unknown> } {
  const json = JSON.parse(readFileSync(resolve(dir, 'model.json'), 'utf8')) as Record<string, unknown>;
  const pesos = readFileSync(resolve(dir, 'weights.bin'));
  return { model: parseMlp(json, pesos.buffer.slice(pesos.byteOffset, pesos.byteOffset + pesos.byteLength)), json };
}

/** Probabilidade mínima das leituras do app (classifier.ts e numberModel.ts). */
const MIN_P = 0.6;
/** Quadros lidos como a outra letra para o par entrar. */
const MIN_QUADROS = 3;

type Origem = 'teste_fixo' | 'numeros_teste' | 'letras_mov' | 'mesma_forma' | 'plano';
const pares = new Map<string, { pedido: string; lido: string; origem: Set<Origem>; quadros: number }>();
function par(pedido: string, lido: string, origem: Origem, quadros = 0) {
  if (pedido === lido || !formas[pedido] || !formas[lido]) return;
  const k = `${pedido}>${lido}`;
  const p = pares.get(k) ?? { pedido, lido, origem: new Set<Origem>(), quadros: 0 };
  p.origem.add(origem);
  p.quadros += quadros;
  pares.set(k, p);
}

interface Anterior { dicas?: Record<string, { o: Origem[]; q: number }> }
const anterior = existsSync(SAIDA) ? (JSON.parse(readFileSync(SAIDA, 'utf8')) as Anterior) : {};

if (DADOS) {
  console.log(`Dados: ${DADOS}`);
  // Letras paradas: teste fixo, quadro a quadro, a mão mais alta (como o teste_fixo.py)
  const letras = modelo(resolve(APP, 'public/ml/classifier')).model;
  const teste = JSON.parse(readFileSync(resolve(DADOS, 'teste_fixo.json'), 'utf8')) as {
    videos: { id: string; paradas: { letra: string; ini: number; fim: number }[] }[];
  };
  const contagem = new Map<string, number>();
  for (const v of teste.videos) {
    const f = resolve(DADOS, 'landmarks', `${v.id}.json`);
    if (!existsSync(f)) continue;
    const d = JSON.parse(readFileSync(f, 'utf8')) as { aspect?: number; frames: { t: number; hands?: { h: string; lm: number[] }[] }[] };
    for (const p of v.paradas) {
      if (p.letra === '_') continue;
      for (const q of d.frames) {
        if (q.t < p.ini || q.t > p.fim || !q.hands?.length) continue;
        const mao = q.hands.reduce((a, b) => (b.lm[1] < a.lm[1] ? b : a));
        if (mao.lm.length < 63) continue;
        const r = classify(letras, normalizeHand(lms(mao.lm), { handedness: mao.h, aspect: d.aspect ?? 1 }));
        if (r.label === '_' || r.label === p.letra || r.probability < MIN_P) continue;
        const k = `${p.letra}>${r.label}`;
        contagem.set(k, (contagem.get(k) ?? 0) + 1);
      }
    }
  }
  for (const [k, n] of contagem) {
    const [a, b] = k.split('>');
    if (n >= MIN_QUADROS) par(a, b, 'teste_fixo', n);
  }
  // Números: pessoas de teste do modelo do app
  const numeros = modelo(resolve(APP, 'public/ml/numeros'));
  const testeNum = new Set((numeros.json.test_channels as string[] | undefined) ?? []);
  const arqNum = resolve(DADOS, 'numeros/dataset_numeros.jsonl');
  if (existsSync(arqNum)) {
    const cont = new Map<string, number>();
    for (const linha of readFileSync(arqNum, 'utf8').split('\n')) {
      if (!linha.trim()) continue;
      const r = JSON.parse(linha) as { label: string; person_id: string; handedness: string; aspect: number; raw?: number[] };
      if (!testeNum.has(r.person_id) || !r.raw || r.raw.length < 63) continue;
      const c = classify(numeros.model, normalizeHand(lms(r.raw), { handedness: r.handedness, aspect: r.aspect }));
      if (c.label === '_' || c.label === r.label || c.probability < MIN_P) continue;
      const k = `${r.label}>${c.label}`;
      cont.set(k, (cont.get(k) ?? 0) + 1);
    }
    for (const [k, n] of cont) {
      const [a, b] = k.split('>');
      if (n >= MIN_QUADROS) par(a, b, 'numeros_teste', n);
    }
  }
} else {
  console.warn('Sem ml-training/data (teste_fixo.json e landmarks/): a lista de pares do JSON anterior continua.');
  for (const [k, p] of Object.entries(anterior.dicas ?? {})) {
    const [pedido, lido] = k.split('>');
    for (const o of p.o) par(pedido, lido, o, o === 'teste_fixo' || o === 'numeros_teste' ? p.q : 0);
  }
}

// Letras com movimento: o modelo só lê estas; qualquer uma pode sair no lugar da outra
const mov = modelo(resolve(APP, 'public/ml/letras-mov')).json;
const letrasMov = (mov.labels as string[]).filter((l) => l !== '_');
for (const a of letrasMov) for (const b of letrasMov) par(a, b, 'letras_mov');
// Mesma forma, com e sem movimento (signs.json: Ç "a mesma do C", J "mínimo estendido" como o I,
// Z "indicador estendido")
for (const [a, b] of [['C', 'Ç'], ['I', 'J'], ['D', 'Z']]) {
  par(a, b, 'mesma_forma');
  par(b, a, 'mesma_forma');
}
// Trocas do plano de lições (seção 3): K como H, P como K, R como U, F e T, X como H ou N
for (const [a, b] of [['K', 'H'], ['P', 'K'], ['R', 'U'], ['F', 'T'], ['T', 'F'], ['X', 'H'], ['X', 'N']]) par(a, b, 'plano');

/* ---------- 3. diferença de cada par ---------- */

const linhas: string[] = [];
for (const [k, p] of [...pares].sort(([a], [b]) => a.localeCompare(b))) {
  const calculada = comparePair(formas[p.pedido], formas[p.lido]);
  const d = withReviewed(k, calculada);
  const rev = DICAS_REVISADAS[k] ? { rev: true } : {};
  linhas.push(`  ${JSON.stringify(k)}: ${JSON.stringify({ ...d, o: [...p.origem].sort(), q: p.quadros, ...rev })}`);
  // Conferência: os itens e as três maiores notas
  const notas = shapeDifferences(formas[p.pedido], formas[p.lido]).slice(0, 3)
    .map((x) => `${x.item.k}${'d' in x.item ? `:${x.item.d}` : ''}:${x.item.v}=${x.score.toFixed(2)}`).join(' ');
  const fala = (x: typeof d) => x.i.map((it) => `${it.k}${'d' in it ? `:${it.d}` : ''}:${it.v}`).join(' + ') || '(sem diferença)';
  console.log(`${k.padEnd(5)} ${fala(d)}  [${notas}]${rev.rev ? `  (revisada; calculada: ${fala(calculada)})` : ''}`);
}

const sobre =
  'Gerado por apps/web-poc/scripts/gerar-dicas-erro.ts. Diferença entre o sinal pedido e o lido pela câmera ("pedido>lido"), ' +
  'calculada nas mãos da mão em 3D (maos-licoes.json) depois do retargeting e da colisão: d = dedos a destacar nas duas mãos; ' +
  'i = itens da dica (vocabulário em i18n wrongHint.*); o = de onde veio o par (teste_fixo: letras trocadas pelo classificador ' +
  'nos vídeos do teste fixo; numeros_teste: números trocados nas pessoas de teste; letras_mov: letras do modelo das letras com ' +
  'movimento; mesma_forma: mesma forma com e sem movimento; plano: trocas do plano de lições); q = quadros trocados nos testes; ' +
  'rev = dica revisada à mão (src/dicaErro/revisadas.ts), porque a calculada contradizia a configuração de mão conferida no signs.json.';
writeFileSync(
  SAIDA,
  `{\n "_sobre": ${JSON.stringify(sobre)},\n "gerado_em": ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n "dicas": {\n${linhas.join(',\n')}\n }\n}\n`,
);
console.log(`${pares.size} pares. Gravado ${SAIDA} (${(readFileSync(SAIDA).length / 1024).toFixed(1)} KB)`);
