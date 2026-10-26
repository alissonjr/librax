/*
 * Gera src/mao3d/maos-licoes.json: as mãos reais que a mão em 3D da apresentação das letras e dos
 * números mostra (src/mao3d/). Mesma ideia do apps/landing/scripts/extrair-maos.ts, para o
 * alfabeto inteiro e os números de 0 a 9, e com o movimento das letras que têm movimento.
 *
 *   npx vite-node scripts/extrair-maos-licoes.ts [-- --dados=<ml-training/data>]
 *
 * Lê ml-training/data (fora do git; no worktree cai no checkout principal) só para leitura:
 * - Letras paradas: as paradas aceitas de rotulos/<id>.json e os landmarks/<id>.json do mesmo
 *   vídeo. Fica a mão que o classificador das letras do app (public/ml/classifier) lê como a letra
 *   certa com MIN_PROB ou mais; uma por canal (pessoas diferentes), as de maior probabilidade.
 * - Letras com movimento (H, J, K, X, Z, Ç): os trechos ok de ml-training/letras_mov_trechos*.json
 *   (e os do INES, a fonte que o curso segue) nos landmarks a 15 quadros por segundo
 *   (letras_mov/landmarks15 e landmarks15_xz). Em cada trecho, a janela (0,8, 1,2 ou 1,6 s) que o
 *   modelo das letras com movimento do app (public/ml/letras-mov) lê como a letra certa, com as
 *   regras de leitura do model.json (limiar e portão de movimento). Sai o movimento dessa janela,
 *   quadro a quadro.
 * - Números: os quadros de numeros/dataset_numeros.jsonl (forma cardinal), lidos pelo modelo dos
 *   números (ml-training/out/numeros-v1, o mesmo formato do classificador das letras). Se houver
 *   data/numeros15 terminado, não é usado aqui: ele é de sequências com movimento.
 *
 * Cada mão sai como os 21 pontos (x, y, z) normalizados como no app (pulso na origem, palmo = 1,
 * mão esquerda espelhada para direita), SEM a rotação que deixa a mão de pé: a orientação real
 * importa (M e N para baixo, números na horizontal). O x é espelhado para a vista de quem olha a
 * pessoa, como no maos.json da landing. No movimento, cada quadro leva também o deslocamento do
 * pulso (em palmos, em relação à média da janela). Números inteiros: valor x 100.
 * Nenhuma imagem, nenhum nome de canal.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLeftHand, normalizeHand } from '../src/recognition/normalize';
import { classify, parseMlp, predict, type MlpModel } from '../src/recognition/mlp';
import {
  LETTER_WINDOWS_S, NO_LETTER, compactLetterWindow, letterWindow, letterWindowMotion, windowHandedness,
  type LetterFrame,
} from '../src/recognition/letterMotion';
import { readingRulesFromJson } from '../src/recognition/readingRules';
import type { Lm } from '../src/lib/recognizer';
import { BONES, clonePose, positions, retarget, rigFromGlbBytes, solveCollisions } from '../src/mao3d/retarget';
import { sceneLandmarks } from '../src/mao3d/cena';

const AQUI = dirname(fileURLToPath(import.meta.url));
const APP = resolve(AQUI, '..');
const RAIZ = resolve(APP, '../..');
const ARG_DADOS = process.argv.find((a) => a.startsWith('--dados='))?.slice(8);
const DADOS = [ARG_DADOS, resolve(RAIZ, 'ml-training/data'), resolve(RAIZ, '../../../ml-training/data')]
  .filter((d): d is string => !!d)
  .map((d) => resolve(d))
  .find((d) => existsSync(resolve(d, 'rotulos')) && existsSync(resolve(d, 'landmarks')));
const SAIDA = resolve(APP, 'src/mao3d/maos-licoes.json');

const PARADAS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'Y'];
const COM_MOVIMENTO = ['H', 'J', 'K', 'X', 'Z', 'Ç'];
const NUMEROS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
/** Mãos (pessoas) por letra ou número parado e movimentos por letra com movimento. */
const POR_SINAL = 4;
const MOVIMENTOS = 3;
const MIN_PROB = 0.6;
/** Janela em volta do meio da parada (s). */
const JANELA = 0.35;
const ESCALA = 100;
/**
 * Fora de propósito: números com "A CONFERIR" no signs.json em que as mãos lidas pelo modelo não
 * batem com a descrição da lição. Mostrar a mão dos dados ensinaria a outra forma.
 */
const FORA: Record<string, string> = {
  '5': 'A descrição (signs.json, A CONFERIR) pede indicador e médio em gancho; a única mão lida pelo modelo tem os dois esticados, como no avatar.',
};

if (!DADOS) {
  console.error('Sem rotulos/ e landmarks/ em ml-training/data. Passe --dados=<caminho de ml-training/data>.');
  process.exit(1);
}
console.log(`Dados: ${DADOS}`);

function modelo(dir: string): { model: MlpModel; json: Record<string, unknown> } {
  const json = JSON.parse(readFileSync(resolve(dir, 'model.json'), 'utf8')) as Record<string, unknown>;
  const pesos = readFileSync(resolve(dir, 'weights.bin'));
  return { model: parseMlp(json, pesos.buffer.slice(pesos.byteOffset, pesos.byteOffset + pesos.byteLength)), json };
}

const letrasParadas = modelo(resolve(APP, 'public/ml/classifier')).model;
const letrasMov = modelo(resolve(APP, 'public/ml/letras-mov'));
const lidas = readingRulesFromJson(letrasMov.json, 0.6);
if (typeof lidas === 'string') throw new Error(`regras do letras-mov: ${lidas}`);
const regras = lidas;
const numerosDir = resolve(DADOS, '../out/numeros-v1');
const numeros = existsSync(resolve(numerosDir, 'model.json')) ? modelo(numerosDir).model : null;

const lms = (raw: readonly number[]): Lm[] =>
  Array.from({ length: 21 }, (_, i) => ({ x: raw[i * 3], y: raw[i * 3 + 1], z: raw[i * 3 + 2] }));

/**
 * 21 pontos na vista da landing (x de quem olha, y para baixo, z do MediaPipe), sem girar a mão:
 * os mesmos passos da normalizeHand até o espelho, e o x espelhado no fim.
 */
function pontos(raw: readonly number[], handedness: string | null, aspect: number): number[] {
  const w = [raw[0], raw[1], raw[2]];
  const p = Array.from({ length: 21 }, (_, i) => [
    (raw[i * 3] - w[0]) * aspect, raw[i * 3 + 1] - w[1], (raw[i * 3 + 2] - w[2]) * aspect,
  ]);
  const [mx, my, mz] = p[9];
  const f = 1 / (Math.sqrt(mx * mx + my * my + mz * mz) || 1e-6);
  const espelha = isLeftHand(handedness);
  return p.flatMap(([x, y, z]) => [(espelha ? x : -x) * f, y * f, z * f]);
}

const inteiro = (v: number) => Math.round(v * ESCALA);

/* ---------- letras paradas ---------- */

interface Parada { ini: number; fim: number; meio?: number; letra: string | null; aceita: boolean }
interface Mao { h: string; s?: number; lm: number[] }
interface Quadro { t: number; hands?: Mao[] }
interface Landmarks { id: string; channel_id?: string; aspect?: number; frames: Quadro[] }
interface Candidata { canal: string; prob: number; pts: number[] }

const candidatas: Record<string, Candidata[]> = Object.fromEntries([...PARADAS, ...NUMEROS].map((l) => [l, []]));

function lerJson<T>(f: string): T | null {
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

for (const arquivo of readdirSync(resolve(DADOS, 'rotulos')).sort()) {
  const rotulo = lerJson<{ id: string; paradas?: Parada[] }>(resolve(DADOS, 'rotulos', arquivo));
  const paradas = (rotulo?.paradas ?? []).filter((p) => p.aceita && p.letra && PARADAS.includes(p.letra));
  if (!rotulo || paradas.length === 0) continue;
  const dados = lerJson<Landmarks>(resolve(DADOS, 'landmarks', `${rotulo.id}.json`));
  if (!dados) continue;
  const aspect = dados.aspect ?? 1;
  for (const p of paradas) {
    const meio = p.meio ?? (p.ini + p.fim) / 2;
    let melhor: Candidata | null = null;
    for (const q of dados.frames) {
      if (Math.abs(q.t - meio) > JANELA || q.t < p.ini || q.t > p.fim) continue;
      for (const mao of q.hands ?? []) {
        if (mao.lm.length < 63) continue;
        const r = classify(letrasParadas, normalizeHand(lms(mao.lm), { handedness: mao.h, aspect }));
        if (r.label !== p.letra || r.probability < MIN_PROB) continue;
        if (!melhor || r.probability > melhor.prob) {
          melhor = { canal: dados.channel_id ?? rotulo.id, prob: r.probability, pts: pontos(mao.lm, mao.h, aspect) };
        }
      }
    }
    if (melhor) candidatas[p.letra!].push(melhor);
  }
}

/* ---------- números ---------- */

if (numeros) {
  const linhas = readFileSync(resolve(DADOS, 'numeros/dataset_numeros.jsonl'), 'utf8').split('\n');
  for (const linha of linhas) {
    if (!linha.trim()) continue;
    const r = JSON.parse(linha) as { label: string; person_id: string; handedness: string; aspect: number; raw: number[] };
    if (!NUMEROS.includes(r.label) || !r.raw || r.raw.length < 63) continue;
    const c = classify(numeros, normalizeHand(lms(r.raw), { handedness: r.handedness, aspect: r.aspect }));
    if (c.label !== r.label || c.probability < MIN_PROB) continue;
    candidatas[r.label].push({ canal: r.person_id, prob: c.probability, pts: pontos(r.raw, r.handedness, r.aspect) });
  }
} else {
  console.warn(`Sem o modelo dos números em ${numerosDir}: números ficam de fora.`);
}

/** As de maior probabilidade, uma por canal. */
function escolher(lista: Candidata[], n: number): Candidata[] {
  const porCanal = new Map<string, Candidata>();
  for (const c of lista) {
    const atual = porCanal.get(c.canal);
    if (!atual || c.prob > atual.prob) porCanal.set(c.canal, c);
  }
  return [...porCanal.values()].sort((a, b) => b.prob - a.prob).slice(0, n);
}

/* ---------- letras com movimento ---------- */

interface Trecho { id: string; channel_id: string; letra: string; ini: number; fim: number; ok: boolean }
interface Movimento { canal: string; prob: number; ines: boolean; forma: number; quadros: number[][] }

const trechosBase = JSON.parse(readFileSync(resolve(RAIZ, 'ml-training/letras_mov_trechos.json'), 'utf8')) as { trechos: Trecho[]; ines: Trecho[] };
const trechosXz = JSON.parse(readFileSync(resolve(RAIZ, 'ml-training/letras_mov_trechos_xz.json'), 'utf8')) as { trechos: Trecho[] };
const trechos = [...trechosBase.ines, ...trechosBase.trechos, ...trechosXz.trechos].filter((t) => t.ok && COM_MOVIMENTO.includes(t.letra));

interface Video { aspect: number; frames: LetterFrame[]; raw: { t: number; hands: Mao[] }[] }
const videos = new Map<string, Video | null>();
function video(id: string): Video | null {
  if (!videos.has(id)) {
    const f = ['landmarks15', 'landmarks15_xz'].map((p) => resolve(DADOS!, 'letras_mov', p, `${id}.json`)).find(existsSync);
    if (!f) {
      videos.set(id, null);
    } else {
      const d = JSON.parse(readFileSync(f, 'utf8')) as { aspect?: number; frames: { t: number; hands?: Mao[] }[] };
      const raw = d.frames.map((q) => ({ t: q.t, hands: (q.hands ?? []).filter((m) => m.lm.length >= 63) }));
      videos.set(id, {
        aspect: d.aspect ?? 1,
        raw,
        frames: raw.map((q) => ({ t: q.t, hands: q.hands.map((m) => ({ handedness: m.h, landmarks: lms(m.lm) })) })),
      });
    }
  }
  return videos.get(id) ?? null;
}

const none = letrasMov.model.labels.indexOf(NO_LETTER);

/**
 * Forma da mão no movimento: a janela que o modelo lê às vezes pega a passagem da letra vizinha
 * (dedos abrindo). Fração dos quadros com a configuração da descrição (signs.json): dedo
 * esticado = da base à ponta quase em linha reta; fechado = bem dobrado.
 */
const MIN_FORMA = 0.7;
const DEDOS = { I: 5, M: 9, A: 13, P: 17 } as const;
function reto(q: readonly number[], base: number): number {
  const p = (i: number) => [q[i * 3], q[i * 3 + 1], q[i * 3 + 2]];
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const pts = [0, 1, 2, 3].map((k) => p(base + k));
  return d(pts[0], pts[3]) / (d(pts[0], pts[1]) + d(pts[1], pts[2]) + d(pts[2], pts[3]));
}
const ESTICADO = 0.85;
const FECHADO = 0.65;
const FORMAS: Record<string, (q: readonly number[]) => boolean> = {
  // Mínimo estendido
  J: (q) => reto(q, DEDOS.P) >= ESTICADO && reto(q, DEDOS.I) <= FECHADO && reto(q, DEDOS.M) <= FECHADO,
  // Indicador estendido
  Z: (q) => reto(q, DEDOS.I) >= ESTICADO && reto(q, DEDOS.M) <= FECHADO && reto(q, DEDOS.A) <= FECHADO,
  // Indicador e médio esticados, anelar e mínimo fechados
  H: (q) => reto(q, DEDOS.I) >= ESTICADO && reto(q, DEDOS.M) >= ESTICADO && reto(q, DEDOS.A) <= FECHADO,
  K: (q) => reto(q, DEDOS.I) >= ESTICADO && reto(q, DEDOS.M) >= ESTICADO && reto(q, DEDOS.A) <= FECHADO,
  // Indicador em gancho (não reto), demais dobrados
  X: (q) => reto(q, DEDOS.I) < 0.95 && reto(q, DEDOS.M) <= FECHADO && reto(q, DEDOS.A) <= FECHADO,
  // Mão em C: nenhum dedo fechado no punho
  'Ç': (q) => [DEDOS.I, DEDOS.M, DEDOS.A, DEDOS.P].every((b) => reto(q, b) > FECHADO),
};
/**
 * A mesma conferência na mão que o app desenha: os pontos do esqueleto do modelo depois do
 * retargeting (retarget.ts) e da colisão, na ordem do MediaPipe. A profundidade do MediaPipe falha
 * com a palma de lado, e aí o retargeting pode abrir um dedo que nos dados está dobrado.
 */
const rig = rigFromGlbBytes(readFileSync(resolve(APP, 'src/mao3d/mao-3d.glb')));
const ORDEM_MP: string[] = [
  'wrist', 'thumb_cmc', 'thumb_mcp', 'thumb_ip', 'thumb_tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap((d) => [`${d}_mcp`, `${d}_pip`, `${d}_dip`, `${d}_tip`]),
];
function desenhada(q: readonly number[]): number[] {
  const pose = retarget(rig, sceneLandmarks((i) => q[i * 3], (i) => q[i * 3 + 1], (i) => q[i * 3 + 2]));
  const pos = positions(rig, solveCollisions(rig, clonePose(pose)));
  return ORDEM_MP.flatMap((n) => {
    const v = pos[(BONES as readonly string[]).indexOf(n)];
    return [v.x, -v.y, -v.z];
  });
}
function forma(letra: string, quadros: readonly number[][]): number {
  const ok = FORMAS[letra];
  if (!ok) return 1;
  const nosDados = quadros.filter((q) => ok(q)).length;
  const naTela = quadros.filter((q) => ok(desenhada(q))).length;
  return Math.min(nosDados, naTela) / quadros.length;
}

/** A janela do trecho que o modelo lê como a letra, com o movimento quadro a quadro; ou null. */
function movimento(t: Trecho): Movimento | null {
  const v = video(t.id);
  if (!v) return null;
  const alvo = letrasMov.model.labels.indexOf(t.letra);
  let melhor: { prob: number; t0: number; t1: number } | null = null;
  for (const q of v.frames) {
    const t1 = q.t;
    if (t1 < t.ini || t1 > t.fim + 1e-6) continue;
    for (const dur of LETTER_WINDOWS_S) {
      const t0 = t1 - dur;
      if (t0 < t.ini - 0.1) continue;
      const w = letterWindow(v.frames, v.aspect, t0, t1);
      if (!w) continue;
      const entrada = compactLetterWindow(w);
      if (letterWindowMotion(entrada, regras.motionShapeWeight) < regras.minMotion) continue;
      const p = predict(letrasMov.model, entrada);
      let best = 0;
      for (let j = 1; j < p.length; j++) if (p[j] > p[best]) best = j;
      if (best !== alvo || p[alvo] < regras.minProbability) continue;
      if (none >= 0 && p[none] > regras.maxNoneProbability) continue;
      // Empate: a janela mais longa (mostra o movimento inteiro)
      if (!melhor || p[alvo] > melhor.prob + 0.01 || (Math.abs(p[alvo] - melhor.prob) <= 0.01 && t1 - t0 > melhor.t1 - melhor.t0)) {
        melhor = { prob: p[alvo], t0, t1 };
      }
    }
  }
  if (!melhor) return null;
  const { t0, t1 } = melhor;
  const rotulo = windowHandedness(v.frames, t0, t1);
  // A mesma mão o trecho todo: a mais alta no primeiro quadro (a regra do app) e, depois, a mais
  // perto do pulso do quadro anterior (o rótulo do MediaPipe às vezes troca no meio; vale o da janela)
  let anterior: Mao | null = null;
  const dentro = v.raw
    .filter((q) => q.t >= t0 - 1e-6 && q.t <= t1 + 1e-6)
    .map((q) => {
      let mao: Mao | null = null;
      if (!anterior) {
        for (const m of q.hands) if (!mao || m.lm[1] < mao.lm[1]) mao = m;
      } else {
        const a: Mao = anterior;
        const d = (m: Mao) => Math.hypot((m.lm[0] - a.lm[0]) * v.aspect, m.lm[1] - a.lm[1]);
        for (const m of q.hands) if (!mao || d(m) < d(mao)) mao = m;
      }
      if (mao) anterior = mao;
      return { t: q.t, mao };
    });
  if (dentro.length < 8) return null;
  // Buraco de até 2 quadros: repete a mão vizinha (a reprodução já interpola). Mais que isso, fora.
  let vazios = 0;
  for (let i = 0; i < dentro.length; i++) {
    if (dentro[i].mao) { vazios = 0; continue; }
    if (++vazios > 2) return null;
  }
  const primeira = dentro.findIndex((q) => q.mao);
  for (let i = 0; i < dentro.length; i++) if (!dentro[i].mao) dentro[i].mao = dentro[i - 1]?.mao ?? dentro[primeira].mao;
  // Pulso em palmos (x vezes o aspecto), espelhado como a mão e depois para a vista de quem olha
  const espelha = isLeftHand(rotulo);
  const palmos = dentro.map(({ mao }) => {
    const m = mao!.lm;
    const dx = (m[27] - m[0]) * v.aspect;
    const dy = m[28] - m[1];
    const dz = (m[29] - m[2]) * v.aspect;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  });
  const palmo = palmos.reduce((a, b) => a + b, 0) / palmos.length;
  const px = dentro.map(({ mao }) => mao!.lm[0] * v.aspect);
  const py = dentro.map(({ mao }) => mao!.lm[1]);
  const mx = px.reduce((a, b) => a + b, 0) / px.length;
  const my = py.reduce((a, b) => a + b, 0) / py.length;
  // Sem saltos: palmo estável (a mão não some nem troca), pulso sem pular entre quadros e o trecho
  // inteiro dentro de alguns palmos (salto grande é erro do MediaPipe ou corte do vídeo)
  if (palmos.some((p) => p / palmo < 0.8 || p / palmo > 1.25)) return null;
  for (let i = 1; i < px.length; i++) if (Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]) / palmo > 0.7) return null;
  if ((Math.max(...px) - Math.min(...px)) / palmo > 3 || (Math.max(...py) - Math.min(...py)) / palmo > 3) return null;
  let quadros = dentro.map(({ mao }, i) => [
    ...pontos(mao!.lm, rotulo, v.aspect),
    ((espelha ? 1 : -1) * (px[i] - mx)) / palmo,
    (py[i] - my) / palmo,
  ]);
  // Tremido do MediaPipe a 15 quadros por segundo: média 1-2-1 com os vizinhos
  quadros = quadros.map((q, i) => {
    const a = quadros[Math.max(0, i - 1)];
    const b = quadros[Math.min(quadros.length - 1, i + 1)];
    return q.map((v2, k) => (a[k] + 2 * v2 + b[k]) / 4);
  });
  const f = forma(t.letra, quadros);
  if (f < MIN_FORMA) return null;
  return { canal: t.channel_id, prob: melhor.prob, ines: t.channel_id === 'ines', forma: f, quadros };
}

const movimentos: Record<string, Movimento[]> = Object.fromEntries(COM_MOVIMENTO.map((l) => [l, []]));
for (const t of trechos) {
  const m = movimento(t);
  if (m) movimentos[t.letra].push(m);
}

/* ---------- saída ---------- */

const sinais: Record<string, { prob: number[]; poses?: number[][]; mov?: number[][][] }> = {};
const relatorio: string[] = [];
for (const s of [...PARADAS, ...NUMEROS]) {
  if (FORA[s]) {
    relatorio.push(`${s}: fora (${FORA[s]})`);
    continue;
  }
  const escolhidas = escolher(candidatas[s], POR_SINAL);
  if (escolhidas.length === 0) {
    relatorio.push(`${s}: nenhuma mão lida pelo modelo (fica de fora)`);
    continue;
  }
  sinais[s] = { prob: escolhidas.map((c) => Math.round(c.prob * 100) / 100), poses: escolhidas.map((c) => c.pts.map(inteiro)) };
  relatorio.push(`${s}: ${escolhidas.length} mãos (de ${new Set(candidatas[s].map((c) => c.canal)).size} pessoas lidas pelo modelo)`);
}
for (const s of COM_MOVIMENTO) {
  // O do INES primeiro (a fonte que o curso segue), depois uma por canal, as de maior probabilidade
  const porCanal = new Map<string, Movimento>();
  for (const m of movimentos[s]) {
    const atual = porCanal.get(m.canal);
    if (!atual || m.prob > atual.prob) porCanal.set(m.canal, m);
  }
  const escolhidos = [...porCanal.values()]
    .sort((a, b) => Number(b.ines) - Number(a.ines) || b.forma - a.forma || b.prob - a.prob)
    .slice(0, MOVIMENTOS);
  if (escolhidos.length === 0) {
    relatorio.push(`${s}: nenhum movimento lido pelo modelo (fica de fora)`);
    continue;
  }
  sinais[s] = { prob: escolhidos.map((m) => Math.round(m.prob * 100) / 100), mov: escolhidos.map((m) => m.quadros.map((q) => q.map(inteiro))) };
  relatorio.push(
    `${s}: ${escolhidos.length} movimentos (${escolhidos.map((m) => `${m.quadros.length} quadros, forma ${Math.round(m.forma * 100)}%${m.ines ? ', INES' : ''}`).join('; ')}) de ${porCanal.size} canais lidos pelo modelo`,
  );
}
console.log(relatorio.join('\n'));

const json = {
  _sobre:
    'Gerado por apps/web-poc/scripts/extrair-maos-licoes.ts a partir de ml-training/data. Mãos reais da mão em 3D da apresentação ' +
    '(src/mao3d/). Cada pose: 21 pontos (x, y, z) x 100, pulso na origem, palmo (pulso -> base do médio) = 100, mão esquerda espelhada, ' +
    'sem girar a mão (a orientação é a real), x espelhado para a vista de quem olha a pessoa, y para baixo, z do MediaPipe (maior é mais longe). ' +
    'mov: quadros a 15 por segundo, cada um com os 63 números da pose e o deslocamento do pulso (x, y) em relação à média da janela, x 100. ' +
    `Só mãos que os modelos do app leem como o sinal certo (letras paradas: public/ml/classifier, ${MIN_PROB} ou mais; letras com movimento: ` +
    'public/ml/letras-mov com as regras de leitura do model.json; números: ml-training/out/numeros-v1). Uma por pessoa ou canal.',
  gerado_em: new Date().toISOString().slice(0, 10),
  fps: 15,
  escala: ESCALA,
  fora: FORA,
  sinais,
};
writeFileSync(SAIDA, `${JSON.stringify(json)}\n`);
console.log(`Gravado ${SAIDA} (${(readFileSync(SAIDA).length / 1024).toFixed(1)} KB)`);
