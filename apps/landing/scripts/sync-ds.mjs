#!/usr/bin/env node
// Copia do web-poc para apps/landing/public os arquivos do design system que a landing serve
// como estão: as fontes (com as licenças), o favicon e os ícones do app. Roda antes do dev e do
// build; os copiados ficam fora do git (public/.gitignore), assim a fonte da verdade continua
// sendo o web-poc. Os tokens não são copiados: o CSS da landing importa o tokens.css gerado.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const ORIGEM = resolve(AQUI, '../../web-poc/public');
const DESTINO = resolve(AQUI, '../public');

const ARQUIVOS = [
  'fonts/Anybody-latin-wdth-wght.woff2',
  'fonts/Anybody-OFL.txt',
  'fonts/Figtree-latin-wght.woff2',
  'fonts/Figtree-OFL.txt',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
];

for (const arquivo of ARQUIVOS) {
  const de = resolve(ORIGEM, arquivo);
  if (!existsSync(de)) {
    console.error(`sync-ds: não achei ${de}`);
    process.exit(1);
  }
  const para = resolve(DESTINO, arquivo);
  mkdirSync(dirname(para), { recursive: true });
  copyFileSync(de, para);
}
console.log(`sync-ds: ${ARQUIVOS.length} arquivos do web-poc em public/`);
