#!/usr/bin/env node
// Gera, a partir do conteudo do app (mesma fonte de verdade):
//   src/content/catalog.js        catalogo minimo das licoes, empacotado em todas as Lambdas
//   src/content/contentStatus.js  situacao do conteudo (validado, fonte, video, avatar), so na
//                                 Lambda do painel de administracao (GET /v1/admin/content)
// O teste test/catalog.test.js falha se algum dos dois ficar defasado. Uso: npm run catalog

import { readFileSync, writeFileSync } from 'node:fs';
import { catalogFromCourse } from '../src/content/catalogFromCourse.js';
import { contentReportFromBundle } from '../src/content/contentReport.js';

const contentDir = new URL('../../../apps/web-poc/src/assets/content/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, contentDir), 'utf8'));
const course = read('course.json');
const signs = read('signs.json');

const header = (source) =>
  `// GERADO por scripts/build-catalog.mjs a partir de apps/web-poc/src/assets/content/${source}.\n` +
  '// Nao edite a mao: rode `npm run catalog`.\n';

const catalog = catalogFromCourse(course);
const catalogTarget = new URL('../src/content/catalog.js', import.meta.url);
writeFileSync(catalogTarget, `${header('course.json')}export default ${JSON.stringify(catalog, null, 2)};\n`);
console.log(`catalogo: ${Object.keys(catalog.lessons).length} licoes -> ${catalogTarget.pathname}`);

const report = contentReportFromBundle(course, signs);
const reportTarget = new URL('../src/content/contentStatus.js', import.meta.url);
writeFileSync(reportTarget, `${header('course.json e signs.json')}export default ${JSON.stringify(report)};\n`);
console.log(`conteudo: ${report.totals.units} unidades, ${report.totals.signs} sinais -> ${reportTarget.pathname}`);
