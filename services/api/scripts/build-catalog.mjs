#!/usr/bin/env node
// Gera src/content/catalog.js a partir do course.json do app (mesma fonte de verdade).
// O arquivo gerado e empacotado nas Lambdas pelo esbuild; o teste test/catalog.test.js
// falha se ele ficar defasado. Uso: npm run catalog

import { readFileSync, writeFileSync } from 'node:fs';
import { catalogFromCourse } from '../src/content/catalogFromCourse.js';

const source = new URL('../../../apps/web-poc/src/assets/content/course.json', import.meta.url);
const target = new URL('../src/content/catalog.js', import.meta.url);

const catalog = catalogFromCourse(JSON.parse(readFileSync(source, 'utf8')));
const header =
  '// GERADO por scripts/build-catalog.mjs a partir de apps/web-poc/src/assets/content/course.json.\n' +
  '// Nao edite a mao: rode `npm run catalog`.\n';
writeFileSync(target, `${header}export default ${JSON.stringify(catalog, null, 2)};\n`);
console.log(`catalogo: ${Object.keys(catalog.lessons).length} licoes -> ${target.pathname}`);
