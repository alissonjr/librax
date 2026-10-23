#!/usr/bin/env node
// Ícones do PWA do Librax (marca Traço), desenhados aqui em SVG com as cores dos tokens.
//
// O desenho: o L de Librax traçado como um movimento, como nos dicionários de Libras. O ponto
// branco marca onde o movimento começa; o traço desce, faz a curva e termina na ponta da seta, em
// tangerina sobre grafite. Geometria copiada de estudo/marca/traco.html (caixa de 64 x 64), a
// mesma do componente BrandMark do app.
//
// Gera em apps/web-poc/public/:
//   favicon.svg             quadrado arredondado, vetorial
//   icon-192.png            ícone "any" (quadrado arredondado, cantos transparentes)
//   icon-512.png            idem
//   icon-maskable-512.png   ícone "maskable": fundo até a borda e o desenho dentro da zona segura
//   apple-touch-icon.png    180 x 180, fundo até a borda (o iOS arredonda sozinho)
//
// Uso (em apps/web-poc):
//   npm run pwa-icons
// A conversão para PNG usa o sharp, que não é dependência do projeto. Se faltar:
//   npm install --no-save sharp && npm run pwa-icons

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOKENS = resolve(ROOT, 'apps/web-poc/src/styles/tokens.ts');
const OUT = resolve(ROOT, 'apps/web-poc/public');

// Lê os valores do tokens.ts gerado (linhas "chave": "valor")
const tokens = Object.fromEntries(
  [...readFileSync(TOKENS, 'utf8').matchAll(/^\s*"([^"]+)":\s*"([^"]+)",?$/gm)].map((m) => [m[1], m[2]]),
);
const token = (name) => {
  if (!tokens[name]) throw new Error(`Token não encontrado: ${name}`);
  return tokens[name];
};

const C = {
  bg: token('brand.icon.bg'),
  mark: token('brand.icon.mark'),
  dot: token('brand.icon.dot'),
};

/** Geometria do símbolo na caixa de 64 x 64 (traco.html): normal e reduzida para a zona segura. */
const GEOMETRY = {
  normal: {
    trace: 'M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0',
    tip: 'M37.0 36.5L52.0 46.0L37.0 55.5z',
    dot: [20, 12.5, 5],
  },
  safe: {
    trace: 'M22.6 23.4V32.7Q22.6 42.9 32.7 42.9H37.4',
    tip: 'M35.9 35.5L47.6 42.9L35.9 50.3z',
    dot: [22.6, 16.8, 3.9],
  },
};

/**
 * SVG 64 x 64. `rx`: 18 no ícone "any" e no favicon, 0 com fundo até a borda.
 * `small`: traço mais grosso e ponto maior, para 16 a 24 px (tamanho mínimo do traco.html).
 */
function svg({ rx, geometry = 'normal', small = false }) {
  const g = GEOMETRY[geometry];
  const [cx, cy, r] = g.dot;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `<rect width="64" height="64" rx="${rx}" fill="${C.bg}"/>`,
    `<path d="${g.trace}" fill="none" stroke="${C.mark}" stroke-width="${small ? 8 : 6.5}" stroke-linecap="round"/>`,
    `<path d="${g.tip}" fill="${C.mark}" stroke="${C.mark}" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${small ? 6 : r}" fill="${C.dot}"/>`,
    '</svg>',
  ].join('');
}

// Zona segura do maskable: círculo de raio 40% no centro; a geometria "safe" do traco.html cabe nele.
// O favicon aparece de 16 a 32 px, então usa o traço grosso do tamanho mínimo.
const SVG_FAVICON = svg({ rx: 18, small: true });
const SVG_ANY = svg({ rx: 18 });
const SVG_FULL = svg({ rx: 0, geometry: 'safe' });
const SVG_APPLE = svg({ rx: 0 });

writeFileSync(resolve(OUT, 'favicon.svg'), `${SVG_FAVICON}\n`);

let sharp;
try {
  // Procura o sharp nos node_modules do web-poc (o script mora fora dele)
  sharp = createRequire(resolve(ROOT, 'apps/web-poc/package.json'))('sharp');
} catch {
  console.error('sharp não encontrado: rode "npm install --no-save sharp" em apps/web-poc e repita. Só o favicon.svg foi gerado.');
  process.exit(1);
}

const png = (source, size, file) =>
  sharp(Buffer.from(source), { density: (72 * size) / 64 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));

await png(SVG_ANY, 192, 'icon-192.png');
await png(SVG_ANY, 512, 'icon-512.png');
await png(SVG_FULL, 512, 'icon-maskable-512.png');
await png(SVG_APPLE, 180, 'apple-touch-icon.png');

console.log(`Ícones do PWA em ${relative(ROOT, OUT)}: favicon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png`);
