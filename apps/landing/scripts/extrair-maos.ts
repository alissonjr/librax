/*
 * Extrai as mãos do LIBRAX da abertura da landing a partir dos dados do treino por vídeo.
 *
 *   npm run maos            (roda com vite-node; lê ml-training/data, grava src/maos.json)
 *
 * Para cada letra (L, I, B, R, A, X):
 * 1. percorre as paradas aceitas de ml-training/data/rotulos/<id>.json com aquela letra;
 * 2. nos landmarks do mesmo vídeo (ml-training/data/landmarks/<id>.json), olha os quadros perto
 *    do meio da parada e cada mão que aparece neles;
 * 3. normaliza com a mesma conta do app (normalizeHand do web-poc: pulso na origem, palmo = 1,
 *    mão esquerda espelhada, de pé) e passa pelo classificador de letras do app
 *    (public/ml/classifier). Só fica a mão que o modelo lê como a letra certa com 0,6 ou mais;
 * 4. guarda uma mão por canal (pessoas diferentes), as de maior probabilidade.
 *
 * Saem só os 21 pontos (x, y) de cada mão, arredondados. Nenhuma imagem, nenhum nome de canal.
 * Os landmarks ficam fora do git (são grandes); o JSON gerado entra no git.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeHand } from '../../web-poc/src/recognition/normalize';
import { parseMlp, classify } from '../../web-poc/src/recognition/mlp';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const ARG_DADOS = process.argv.find((a) => a.startsWith('--dados='))?.slice(8);
/** No worktree os landmarks não existem; cai no checkout principal se for o caso. */
const DADOS = resolve(ARG_DADOS ?? resolve(RAIZ, 'ml-training/data'));
const CLASSIFICADOR = resolve(RAIZ, 'apps/web-poc/public/ml/classifier');
const SAIDA = resolve(AQUI, '../src/maos.json');

const LETRAS = ['L', 'I', 'B', 'R', 'A', 'X'] as const;
const POR_LETRA = 8;
const MIN_PROB = 0.6;
/** Janela em volta do meio da parada (s). */
const JANELA = 0.35;

interface Parada { ini: number; fim: number; meio?: number; letra: string | null; aceita: boolean }
interface Rotulo { id: string; paradas?: Parada[] }
interface Mao { h: string; s?: number; lm: number[] }
interface Quadro { t: number; hands?: Mao[] }
interface Landmarks { id: string; channel_id?: string; aspect?: number; frames: Quadro[] }

if (!existsSync(resolve(DADOS, 'rotulos')) || !existsSync(resolve(DADOS, 'landmarks'))) {
  console.error(`Sem rotulos/ e landmarks/ em ${DADOS}. Passe --dados=<caminho de ml-training/data>.`);
  process.exit(1);
}

const modelJson = JSON.parse(readFileSync(resolve(CLASSIFICADOR, 'model.json'), 'utf8'));
const pesos = readFileSync(resolve(CLASSIFICADOR, 'weights.bin'));
const modelo = parseMlp(modelJson, pesos.buffer.slice(pesos.byteOffset, pesos.byteOffset + pesos.byteLength));

interface Candidata { canal: string; prob: number; pts: number[] }
const candidatas: Record<string, Candidata[]> = Object.fromEntries(LETRAS.map((l) => [l, []]));
const cache = new Map<string, Landmarks | null>();

function landmarks(id: string): Landmarks | null {
  if (!cache.has(id)) {
    const f = resolve(DADOS, 'landmarks', `${id}.json`);
    cache.set(id, existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Landmarks) : null);
  }
  return cache.get(id) ?? null;
}

for (const arquivo of readdirSync(resolve(DADOS, 'rotulos')).sort()) {
  const rotulo = JSON.parse(readFileSync(resolve(DADOS, 'rotulos', arquivo), 'utf8')) as Rotulo;
  for (const p of rotulo.paradas ?? []) {
    if (!p.aceita || !p.letra || !(LETRAS as readonly string[]).includes(p.letra)) continue;
    const dados = landmarks(rotulo.id);
    if (!dados) continue;
    const meio = p.meio ?? (p.ini + p.fim) / 2;
    let melhor: Candidata | null = null;
    for (const q of dados.frames) {
      if (Math.abs(q.t - meio) > JANELA || q.t < p.ini || q.t > p.fim) continue;
      for (const mao of q.hands ?? []) {
        if (mao.lm.length < 63) continue;
        const lms = Array.from({ length: 21 }, (_, i) => ({ x: mao.lm[i * 3], y: mao.lm[i * 3 + 1], z: mao.lm[i * 3 + 2] }));
        const vetor = normalizeHand(lms, { handedness: mao.h, aspect: dados.aspect ?? 1 });
        const r = classify(modelo, vetor);
        if (r.label !== p.letra || r.probability < MIN_PROB) continue;
        if (!melhor || r.probability > melhor.prob) {
          // x e y do vetor normalizado: pulso em (0, 0), base do dedo médio em (0, -1). O x é
          // espelhado para a mão aparecer como quem olha a pessoa sinalizando (como nos
          // dicionários e na ilustração de boas-vindas do app): no L, o polegar fica à direita.
          const pts: number[] = [];
          for (let i = 0; i < 21; i++) pts.push(-vetor[i * 3], vetor[i * 3 + 1]);
          melhor = { canal: dados.channel_id ?? rotulo.id, prob: r.probability, pts };
        }
      }
    }
    if (melhor) candidatas[p.letra].push(melhor);
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const saida: Record<string, { pessoas: number; centro: number[]; poses: number[][]; prob: number[] }> = {};
let lado = 0;

for (const letra of LETRAS) {
  const porCanal = new Map<string, Candidata>();
  for (const c of candidatas[letra]) {
    const atual = porCanal.get(c.canal);
    if (!atual || c.prob > atual.prob) porCanal.set(c.canal, c);
  }
  const escolhidas = [...porCanal.values()].sort((a, b) => b.prob - a.prob).slice(0, POR_LETRA);
  if (escolhidas.length < 3) throw new Error(`Poucas mãos boas para ${letra}: ${escolhidas.length}`);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of escolhidas) {
    for (let i = 0; i < 21; i++) {
      minX = Math.min(minX, c.pts[i * 2]); maxX = Math.max(maxX, c.pts[i * 2]);
      minY = Math.min(minY, c.pts[i * 2 + 1]); maxY = Math.max(maxY, c.pts[i * 2 + 1]);
    }
  }
  lado = Math.max(lado, maxX - minX, maxY - minY);
  saida[letra] = {
    pessoas: porCanal.size,
    centro: [r3((minX + maxX) / 2), r3((minY + maxY) / 2)],
    poses: escolhidas.map((c) => c.pts.map(r3)),
    prob: escolhidas.map((c) => Math.round(c.prob * 1000) / 1000),
  };
  console.log(`${letra}: ${escolhidas.length} mãos (de ${porCanal.size} pessoas lidas pelo modelo)`);
}

const json = {
  _sobre:
    'Gerado por apps/landing/scripts/extrair-maos.ts a partir de ml-training/data (rotulos + landmarks). ' +
    'Pontos (x, y) dos 21 landmarks da mão, normalizados como no app (pulso em (0,0), base do dedo médio em (0,-1)) e com o x espelhado para a vista de quem olha a pessoa. ' +
    'lado: lado da caixa comum (mesma escala em todas as letras); centro: centro da caixa de cada letra. ' +
    `Só mãos que o classificador de letras lê como a letra certa com ${MIN_PROB} ou mais; uma por pessoa ou canal.`,
  gerado_em: new Date().toISOString().slice(0, 10),
  lado: r3(lado),
  letras: saida,
};
writeFileSync(SAIDA, `${JSON.stringify(json)}\n`);
console.log(`Gravado ${SAIDA}`);
