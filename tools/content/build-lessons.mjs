#!/usr/bin/env node
// Gera o bundle de exercícios do Librax: um arquivo por lição em
// apps/web-poc/src/assets/content/lessons/<lesson_id>.json, no schema da spec-03 seção 3.
// A composição está em tools/content/compose.mjs.
//
// Uso:
//   node tools/content/build-lessons.mjs           gera os arquivos (e apaga os de lições que saíram)
//   node tools/content/build-lessons.mjs --check   não grava; falha (exit 1) se o bundle estiver desatualizado
//
// Rode depois de mudar course.json, signs.json ou a composição (npm run content em apps/web-poc).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeCourse, lessonFile } from './compose.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT = resolve(ROOT, 'apps/web-poc/src/assets/content');
const OUT_DIR = resolve(CONTENT, 'lessons');
const CHECK = process.argv.includes('--check');

const course = JSON.parse(readFileSync(resolve(CONTENT, 'course.json'), 'utf8'));
const signs = JSON.parse(readFileSync(resolve(CONTENT, 'signs.json'), 'utf8'));
const bundle = composeCourse(course, signs);

const wanted = new Map(
  Object.entries(bundle).map(([id, exercises]) => [`${id}.json`, `${JSON.stringify(lessonFile(id, exercises), null, 2)}\n`]),
);
const existing = existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.json')) : [];

const stale = [
  ...[...wanted].filter(([file, text]) => {
    const path = resolve(OUT_DIR, file);
    return !existsSync(path) || readFileSync(path, 'utf8') !== text;
  }).map(([file]) => file),
  ...existing.filter((f) => !wanted.has(f)),
];

const rel = relative(ROOT, OUT_DIR);
if (CHECK) {
  if (stale.length) {
    console.error(`Bundle de lições desatualizado em ${rel} (${stale.join(', ')}). Rode "npm run content" em apps/web-poc.`);
    process.exit(1);
  }
  console.log(`Bundle de lições em dia: ${wanted.size} lições.`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, text] of wanted) writeFileSync(resolve(OUT_DIR, file), text);
  for (const file of existing.filter((f) => !wanted.has(f))) unlinkSync(resolve(OUT_DIR, file));
  const total = Object.values(bundle).reduce((n, ex) => n + ex.length, 0);
  console.log(`Gerado ${rel}: ${wanted.size} lições, ${total} exercícios.`);
}
