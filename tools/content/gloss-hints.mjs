#!/usr/bin/env node
// Levantamento das descrições de sinal (video_caption em signs.json) que citam a glosa de OUTRO
// sinal do curso, por exemplo "(HOMEM)" na descrição de PAI. Também olha a nota de movimento
// (params.MOV), que o mc4 da prática mostra junto da descrição nos sinais com movimento.
// Nos exercícios de escolha isso pode dar pista: se HOMEM também é uma das opções, a descrição
// entrega qual é qual.
//
// Só lê: não altera o conteúdo (as descrições ainda são rascunho a validar).
//
// A busca segue o maskGloss do app (apps/web-poc/src/lib/content.ts): palavra inteira, sem
// diferenciar maiúscula, glosa composta com hífen ou espaço, glosas de 1 letra de fora.
// "citação" = a glosa aparece em maiúsculas, como nome de sinal; "palavra" = aparece como
// palavra comum do texto (ex.: "casa", "mão"), que também pode ajudar a adivinhar.
//
// Uso:
//   node tools/content/gloss-hints.mjs           tabela para leitura
//   node tools/content/gloss-hints.mjs --json    saída em JSON
//   node tools/content/gloss-hints.mjs --citacoes só as citações em maiúsculas

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CONTENT = resolve(ROOT, 'apps/web-poc/src/assets/content');
const JSON_OUT = process.argv.includes('--json');
const ONLY_CITATIONS = process.argv.includes('--citacoes');

const signs = JSON.parse(readFileSync(resolve(CONTENT, 'signs.json'), 'utf8'));
const lessonsDir = resolve(CONTENT, 'lessons');
const exercises = readdirSync(lessonsDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(resolve(lessonsDir, f), 'utf8')).exercises);

const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const glossRegex = (gloss) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${gloss.toLowerCase().split('-').map(escape).join('[\\s-]+')}(?![\\p{L}\\p{N}])`, 'giu');

// Exercícios do bundle em que os dois sinais aparecem juntos como opções fixas
function together(a, b) {
  return exercises
    .filter((e) => {
      const p = e.payload;
      const ids = p.video_options ?? p.pairs?.map((x) => x.sign_id) ?? [];
      return ids.includes(a) && ids.includes(b);
    })
    .map((e) => e.id);
}

const byGloss = new Map();
for (const s of signs) {
  if (s.gloss.length < 2) continue;
  if (!byGloss.has(s.gloss)) byGloss.set(s.gloss, s);
}

function scan(sign, field, text) {
  const hits = [];
  for (const [gloss, other] of byGloss) {
    if (other.id === sign.id || gloss === sign.gloss) continue;
    const found = text.match(glossRegex(gloss));
    if (!found) continue;
    const citation = found.some((m) => m === m.toUpperCase() && /\p{Lu}/u.test(m));
    if (ONLY_CITATIONS && !citation) continue;
    hits.push({ gloss, signId: other.id, field, kind: citation ? 'citacao' : 'palavra', together: together(sign.id, other.id) });
  }
  return hits;
}

const report = [];
for (const sign of signs) {
  const caption = sign.video_caption ?? '';
  const hits = scan(sign, 'descricao', caption);
  if (sign.recognition === 'dynamic' && sign.params?.MOV) hits.push(...scan(sign, 'movimento', sign.params.MOV));
  if (hits.length) report.push({ signId: sign.id, gloss: sign.gloss, caption, hits });
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const citations = report.filter((r) => r.hits.some((h) => h.kind === 'citacao'));
  console.log(`${report.length} descrições citam glosa de outro sinal (${citations.length} com citação em maiúsculas).\n`);
  for (const r of report) {
    const list = r.hits
      .map((h) => `${h.gloss} (${h.kind}${h.field === 'movimento' ? ' no movimento' : ''}${h.together.length ? `; junto em ${h.together.join(', ')}` : ''})`)
      .join('; ');
    console.log(`${r.gloss}: ${list}`);
    console.log(`  "${r.caption}"`);
  }
}
