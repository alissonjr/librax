#!/usr/bin/env node
// Prepara os arquivos do avatar VLibras servidos pelo próprio app, em vez de buscá-los nos
// servidores do Governo Federal a cada uso (lentos e às vezes fora do ar):
//
// - Player (LGPL-3.0, sem alteração): unity-loader.js, playerweb.json e os três .unityweb da
//   versão PLAYER_VERSION, do repositório oficial publicado no jsDelivr (é para lá que
//   vlibras.gov.br/app/unity redireciona). Destino: public/vlibras/v<versão>/.
// - Animações: uma por glosa do avatar dos sinais do curso (signs.json, avatar.gloss), do
//   dicionário estático do VLibras. Destino: public/vlibras/sinais/<BUNDLES_VERSION>/<GLOSA>
//   (sem extensão: o Unity monta a URL como baseUrl + glosa).
//
// Tudo é baixado uma única vez para .cache/vlibras/ (fora do git) e conferido pelo SHA-256 de
// scripts/vlibras-manifest.json. Glosa nova no curso entra no manifesto na primeira vez (o
// script avisa; versione o manifesto). Arquivo que mudou no servidor é erro.
//
// Roda antes do dev e do build. Uso manual:
//   node scripts/vlibras-assets.mjs [--opcional]
// --opcional (dev): falha de rede vira aviso; sem os arquivos o avatar cai na descrição em texto.
// LIBRAX_VLIBRAS_OPCIONAL=1 faz o mesmo no build (prebuild), para publicar mesmo com os servidores do
// VLibras fora do ar (infra/scripts/lancar-cloudshell.sh --vlibras-opcional).

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(APP, 'scripts/vlibras-manifest.json');
const SIGNS = resolve(APP, 'src/assets/content/signs.json');
const CACHE_DIR = resolve(APP, '.cache/vlibras');
const PUBLIC_DIR = resolve(APP, 'public/vlibras');

// Precisam bater com src/lib/vlibras.ts e public/vlibras/player.html
export const PLAYER_VERSION = '7.12.2';
export const BUNDLES_VERSION = '2018.3.1';

const PLAYER_URL = `https://cdn.jsdelivr.net/gh/spbgovbr-vlibras/vlibras-portal@v${PLAYER_VERSION}/app/unity/`;
const PLAYER_FILES = [
  'unity-loader.js',
  'playerweb.json',
  'playerweb.data.unityweb',
  'playerweb.wasm.code.unityweb',
  'playerweb.wasm.framework.unityweb',
];
const BUNDLES_URL = `https://dicionario2.vlibras.gov.br/static/BUNDLES/${BUNDLES_VERSION}/WEBGL/BR/`;

const optional = process.argv.includes('--opcional') || process.env.LIBRAX_VLIBRAS_OPCIONAL === '1';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function courseGlosses() {
  const raw = JSON.parse(readFileSync(SIGNS, 'utf8'));
  const signs = Array.isArray(raw) ? raw : Object.values(raw);
  const glosses = new Set();
  for (const s of signs) {
    if (s.avatar?.provider === 'vlibras' && s.avatar.gloss) {
      for (const g of s.avatar.gloss.split(' ')) if (g) glosses.add(g);
    }
  }
  return [...glosses].sort();
}

async function download(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

/** Garante o arquivo no cache, conferido pelo manifesto. Devolve o caminho no cache. */
async function ensure(key, url, manifest, added) {
  const cached = resolve(CACHE_DIR, key);
  const expected = manifest[key];
  if (existsSync(cached)) {
    const got = sha256(readFileSync(cached));
    if (!expected || got === expected) {
      if (!expected) { manifest[key] = got; added.push(key); }
      return cached;
    }
  }
  const buf = await download(url);
  const got = sha256(buf);
  if (expected && got !== expected) {
    throw new Error(`SHA-256 de ${key} não confere (esperado ${expected}, veio ${got}): o arquivo mudou no servidor`);
  }
  mkdirSync(dirname(cached), { recursive: true });
  writeFileSync(cached, buf);
  if (!expected) { manifest[key] = got; added.push(key); }
  return cached;
}

function copyIfChanged(from, to) {
  if (existsSync(to) && statSync(from).size === statSync(to).size) return 0;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return 1;
}

/** Tira de public/vlibras/ o que não é desta versão (só pastas geradas por este script). */
function prune(dir, keep) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !keep.has(entry.name)) rmSync(resolve(dir, entry.name), { recursive: true, force: true });
  }
}

async function main() {
  const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : {};
  const added = [];
  let copied = 0;

  const playerDir = `v${PLAYER_VERSION}`;
  for (const file of PLAYER_FILES) {
    const key = `player/${PLAYER_VERSION}/${file}`;
    const cached = await ensure(key, PLAYER_URL + file, manifest, added);
    copied += copyIfChanged(cached, resolve(PUBLIC_DIR, playerDir, file));
  }

  const glosses = courseGlosses();
  const queue = [...glosses];
  const failed = [];
  // Algumas em paralelo: o servidor do dicionário é lento, mas aguenta poucas conexões
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const gloss = queue.shift();
      const key = `sinais/${BUNDLES_VERSION}/${gloss}`;
      try {
        const cached = await ensure(key, BUNDLES_URL + encodeURIComponent(gloss), manifest, added);
        copied += copyIfChanged(cached, resolve(PUBLIC_DIR, 'sinais', BUNDLES_VERSION, gloss));
      } catch (err) {
        failed.push(`${gloss} (${err.message})`);
      }
    }
  }));

  prune(PUBLIC_DIR, new Set([playerDir, 'sinais']));
  prune(resolve(PUBLIC_DIR, 'sinais'), new Set([BUNDLES_VERSION]));

  if (added.length) {
    const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(MANIFEST, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`[vlibras-assets] ${added.length} arquivo(s) novo(s) no manifesto: versione scripts/vlibras-manifest.json`);
  }
  if (failed.length) {
    throw new Error(`${failed.length} animação(ões) sem download: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? '...' : ''}`);
  }
  console.log(`[vlibras-assets] public/vlibras pronto: player ${PLAYER_VERSION} e ${glosses.length} animações (${copied} arquivo(s) atualizado(s))`);
}

main().catch((err) => {
  console.error(`[vlibras-assets] ${err.message}`);
  if (!optional) process.exit(1);
  console.error('[vlibras-assets] seguindo sem os arquivos (--opcional): o avatar cai na descrição em texto');
});
