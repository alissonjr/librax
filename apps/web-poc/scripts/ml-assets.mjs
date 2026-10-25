#!/usr/bin/env node
// Prepara os arquivos de ML servidos pelo próprio app em public/ml/<versao>/ (decisão 6 e seção
// 3.1 do docs/plano-mobile-web.md). Nada vem de CDN em tempo de execução.
//
// - WASM: copiado de node_modules/@mediapipe/tasks-vision/wasm (a <versao> é a do pacote, fixada
//   sem ^ no package.json, então JS e WASM nunca divergem).
// - Modelos hand_landmarker.task e pose_landmarker_lite.task: baixados uma única vez para
//   .cache/ml/ (fora do git), conferidos pelo SHA-256 abaixo e copiados para public/ml/<versao>/.
//   Depois disso funciona sem internet. O de pose (corpo) só é pedido pelo app nos sinais com
//   movimento, quando há modelo em public/ml/sinais/; sem ele fica parado no build.
//
// Roda sozinho antes do dev e do build (predev, predev:celular, prebuild). Uso manual:
//   node scripts/ml-assets.mjs
// public/ml/<versao>/ é gerado (está no .gitignore); public/ml/classifier/ é do classificador
// treinado e public/ml/sinais/ o dos sinais com movimento: nenhum dos dois é tocado aqui.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = resolve(APP, 'node_modules/@mediapipe/tasks-vision');
const PUBLIC_ML = resolve(APP, 'public/ml');
const CACHE_DIR = resolve(APP, '.cache/ml');

// Modelos float16 versão 1. O da mão é o que o app usava do Google Storage; o do corpo é o mesmo
// arquivo que o treino dos sinais usou (ml-training/data/modelos/pose_landmarker_lite.task).
const MODELS = [
  {
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    cacheName: 'hand_landmarker-float16-1.task',
    file: 'hand_landmarker.task',
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    bytes: 7819105,
  },
  {
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    cacheName: 'pose_landmarker_lite-float16-1.task',
    file: 'pose_landmarker_lite.task',
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
    bytes: 5777746,
  },
];

// FilesetResolver.forVisionTasks escolhe entre estes dois conforme o suporte a SIMD do navegador
// (Safari 16.4+ e Chrome atuais usam o com SIMD). A variante "module" não é usada.
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function sameFile(a, b) {
  return existsSync(b) && statSync(a).size === statSync(b).size;
}

async function ensureModel(model) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cached = resolve(CACHE_DIR, model.cacheName);
  if (existsSync(cached) && sha256(readFileSync(cached)) === model.sha256) return cached;

  console.log(`[ml-assets] baixando o modelo uma única vez: ${model.url}`);
  const res = await fetch(model.url);
  if (!res.ok) throw new Error(`download do modelo falhou: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== model.sha256) {
    throw new Error(`SHA-256 de ${model.file} não confere (esperado ${model.sha256}, veio ${got})`);
  }
  writeFileSync(cached, buf);
  return cached;
}

async function main() {
  if (!existsSync(PKG_DIR)) {
    console.error('[ml-assets] @mediapipe/tasks-vision não encontrado. Rode "npm ci" em apps/web-poc.');
    process.exit(1);
  }
  const version = JSON.parse(readFileSync(resolve(PKG_DIR, 'package.json'), 'utf8')).version;
  const dest = resolve(PUBLIC_ML, version);
  mkdirSync(resolve(dest, 'wasm'), { recursive: true });

  // Pastas de versões antigas saem para não irem para o build
  for (const entry of readdirSync(PUBLIC_ML, { withFileTypes: true })) {
    if (entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name) && entry.name !== version) {
      rmSync(resolve(PUBLIC_ML, entry.name), { recursive: true, force: true });
      console.log(`[ml-assets] removida a versão antiga public/ml/${entry.name}`);
    }
  }

  let copied = 0;
  for (const file of WASM_FILES) {
    const from = resolve(PKG_DIR, 'wasm', file);
    const to = resolve(dest, 'wasm', file);
    if (!sameFile(from, to)) { copyFileSync(from, to); copied++; }
  }

  for (const m of MODELS) {
    const model = await ensureModel(m);
    const modelDest = resolve(dest, m.file);
    if (!sameFile(model, modelDest)) { copyFileSync(model, modelDest); copied++; }
  }

  console.log(`[ml-assets] public/ml/${version}/ pronto (${copied} arquivo(s) atualizado(s))`);
}

main().catch((err) => {
  console.error(`[ml-assets] ${err.message}`);
  process.exit(1);
});
