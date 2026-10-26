#!/usr/bin/env node
// Recalcula os números do treino por vídeo (bloco "treino" de src/numeros.json) a partir de
// ml-training/data e mostra o que mudou. Os outros blocos (curso, modelos, offline, testes)
// são editados à mão quando o app muda.
//
//   npm run numeros                       mostra a diferença, não grava
//   npm run numeros -- --gravar           grava em src/numeros.json (e a data de hoje)
//   npm run numeros -- --dados=<pasta>    outra pasta de dados (ex.: o checkout principal)
//
// Definições:
//   videos            vídeos diferentes: os .mp4 de data/videos mais os que só existem nas extrações
//                     a 15 quadros por segundo (EXTRACOES_15, ex.: ines-K e sts-K das letras com
//                     movimento). O mesmo id em mais de uma pasta conta uma vez.
//   horas_*           soma de "duration" desses vídeos, uma vez por vídeo; alfabeto = tipo "letra",
//                     "alfabeto", "numero" ou "sequencia", sinais = tipo "sinal"
//   pessoas_*         channel_id diferentes entre os vídeos de cada grupo; pessoas_total sem repetir
//                     o canal que aparece nos dois grupos
//   quadros_mil       quadros com landmarks gravados em todas as extrações (landmarks/,
//                     landmarks_sinais/ e as de 15 quadros por segundo), em milhares
//   sinais_dicionario glosas diferentes nos vídeos de dicionário (id "dic-...": INES, Spread the Sign)
//
// Dados de cada vídeo: fontes.json e fontes_sinais.json, depois as listas das extrações novas
// (LISTAS_15) e, por último, o cabeçalho do próprio arquivo de landmarks (id, tipo, channel_id,
// duration), que as extrações a 15 quadros por segundo sempre gravam.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ = resolve(AQUI, '../src/numeros.json');
const arg = process.argv.find((a) => a.startsWith('--dados='));
const DADOS = resolve(arg ? arg.slice(8) : resolve(AQUI, '../../../ml-training/data'));
const GRAVAR = process.argv.includes('--gravar');

/** Extrações a 15 quadros por segundo (uma pasta de landmarks por rodada). */
const EXTRACOES_15 = [
  'sinais15/landmarks',
  'sinais15/landmarks_extra',
  'numeros15/landmarks',
  'letras_mov/landmarks15',
  'letras_mov/landmarks15_xz',
  'letras_mov/landmarks15_z2',
];
/** Listas de vídeos das extrações novas (mesmo formato de fontes.json). */
const LISTAS_15 = ['sinais15/fontes_extra.json', 'letras_mov/fontes_xz.json', 'letras_mov/fontes_z2.json'];

const precisa = ['videos', 'fontes.json', 'fontes_sinais.json'];
for (const p of precisa) {
  if (!existsSync(resolve(DADOS, p))) {
    console.error(`Sem ${p} em ${DADOS}. Passe --dados=<caminho de ml-training/data>.`);
    process.exit(1);
  }
}

const lerJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fontes = new Map();
const listas = ['fontes.json', 'fontes_sinais.json', ...LISTAS_15.filter((l) => existsSync(resolve(DADOS, l)))];
for (const l of listas) {
  for (const f of lerJson(resolve(DADOS, l))) if (f?.id && !fontes.has(f.id)) fontes.set(f.id, f);
}
const videos = new Set(readdirSync(resolve(DADOS, 'videos')).filter((f) => extname(f) === '.mp4').map((f) => basename(f, '.mp4')));

/** Arquivos .json de landmarks de uma pasta (id = nome do arquivo). */
const arquivosLm = (pasta) => {
  const dir = resolve(DADOS, pasta);
  return existsSync(dir) ? readdirSync(dir).filter((f) => extname(f) === '.json').map((f) => resolve(dir, f)) : [];
};

let quadros = 0;
for (const pasta of ['landmarks', 'landmarks_sinais', ...EXTRACOES_15]) {
  const extracao15 = EXTRACOES_15.includes(pasta);
  for (const arq of arquivosLm(pasta)) {
    let d;
    try {
      d = lerJson(arq);
    } catch {
      continue; /* arquivo sendo gravado agora pela análise: entra na próxima rodada */
    }
    quadros += d.frames?.length ?? 0;
    if (!extracao15) continue;
    const id = d.id ?? basename(arq, '.json');
    videos.add(id);
    // O cabeçalho do arquivo vale quando o vídeo não está em nenhuma lista (ines-K, sts-K)
    if (!fontes.has(id)) fontes.set(id, { id, tipo: d.tipo, channel_id: d.channel_id, duration: d.duration, glosa: d.glosa, rotulo: d.rotulo });
  }
}

let segAlfabeto = 0;
let segSinais = 0;
const canaisAlfabeto = new Set();
const canaisSinais = new Set();
const glosasDic = new Set();
for (const id of videos) {
  const f = fontes.get(id);
  if (!f) continue;
  const canal = f.channel_id ?? f.channel ?? id;
  if (f.tipo === 'sinal') {
    segSinais += f.duration ?? 0;
    canaisSinais.add(canal);
    if (id.startsWith('dic-')) glosasDic.add(f.glosa ?? f.rotulo);
  } else {
    segAlfabeto += f.duration ?? 0;
    canaisAlfabeto.add(canal);
  }
}

const h = (s) => Math.round((s / 3600) * 10) / 10;
const novo = {
  videos: videos.size,
  horas_total: h(segAlfabeto + segSinais),
  horas_alfabeto: h(segAlfabeto),
  horas_sinais: h(segSinais),
  pessoas_alfabeto: canaisAlfabeto.size,
  pessoas_sinais: canaisSinais.size,
  pessoas_total: new Set([...canaisAlfabeto, ...canaisSinais]).size,
  quadros_mil: Math.floor(quadros / 1000),
  sinais_dicionario: glosasDic.size,
};

const numeros = lerJson(ARQ);
let mudou = false;
for (const [k, v] of Object.entries(novo)) {
  const antes = numeros.treino[k];
  const marca = antes === v ? '  ' : '* ';
  if (antes !== v) mudou = true;
  console.log(`${marca}${k.padEnd(18)} ${String(antes).padStart(8)} -> ${v}`);
}
if (!mudou) console.log('Nada mudou.');
if (GRAVAR && mudou) {
  numeros.treino = { ...numeros.treino, ...novo };
  numeros.atualizado_em = new Date().toISOString().slice(0, 10);
  numeros.fonte = `npm run numeros em ${numeros.atualizado_em}`;
  writeFileSync(ARQ, `${JSON.stringify(numeros, null, 2)}\n`);
  console.log(`Gravado ${ARQ}`);
} else if (mudou) {
  console.log('Para gravar: npm run numeros -- --gravar');
}
