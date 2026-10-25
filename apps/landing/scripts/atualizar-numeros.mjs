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
//   videos            arquivos .mp4 em data/videos
//   horas_*           soma de "duration" (fontes.json + fontes_sinais.json) dos vídeos baixados;
//                     alfabeto = tipo "letra" ou "alfabeto", sinais = tipo "sinal"
//   pessoas_*         channel_id diferentes entre os vídeos baixados de cada grupo
//   quadros_mil       quadros com landmarks gravados (landmarks/ + landmarks_sinais/), em milhares
//   sinais_dicionario glosas diferentes nos vídeos de dicionário (id "dic-...": INES, Spread the Sign)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQ = resolve(AQUI, '../src/numeros.json');
const arg = process.argv.find((a) => a.startsWith('--dados='));
const DADOS = resolve(arg ? arg.slice(8) : resolve(AQUI, '../../../ml-training/data'));
const GRAVAR = process.argv.includes('--gravar');

const precisa = ['videos', 'fontes.json', 'fontes_sinais.json'];
for (const p of precisa) {
  if (!existsSync(resolve(DADOS, p))) {
    console.error(`Sem ${p} em ${DADOS}. Passe --dados=<caminho de ml-training/data>.`);
    process.exit(1);
  }
}

const lerJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const fontes = new Map();
for (const f of [...lerJson(resolve(DADOS, 'fontes.json')), ...lerJson(resolve(DADOS, 'fontes_sinais.json'))]) {
  if (!fontes.has(f.id)) fontes.set(f.id, f);
}
const baixados = readdirSync(resolve(DADOS, 'videos')).filter((f) => extname(f) === '.mp4').map((f) => basename(f, '.mp4'));

let segAlfabeto = 0;
let segSinais = 0;
const canaisAlfabeto = new Set();
const canaisSinais = new Set();
const glosasDic = new Set();
for (const id of baixados) {
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

let quadros = 0;
for (const pasta of ['landmarks', 'landmarks_sinais']) {
  const dir = resolve(DADOS, pasta);
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir)) {
    if (extname(f) !== '.json') continue;
    try {
      quadros += lerJson(resolve(dir, f)).frames?.length ?? 0;
    } catch {
      /* arquivo sendo gravado agora pela análise: entra na próxima rodada */
    }
  }
}

const h = (s) => Math.round((s / 3600) * 10) / 10;
const novo = {
  videos: baixados.length,
  horas_total: h(segAlfabeto + segSinais),
  horas_alfabeto: h(segAlfabeto),
  horas_sinais: h(segSinais),
  pessoas_alfabeto: canaisAlfabeto.size,
  pessoas_sinais: canaisSinais.size,
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
