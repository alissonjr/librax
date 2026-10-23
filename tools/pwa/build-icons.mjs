#!/usr/bin/env node
// Ícones do PWA do Librax, desenhados aqui em SVG com as cores dos tokens.
//
// O desenho: a mão fazendo a letra L da datilologia (indicador para cima, polegar de lado),
// traçada como o esqueleto da câmera, com os pontos das articulações em turquesa. É o "L" de
// Librax e a mão que é a protagonista do app (design-system-proposta, princípio 1).
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
  bgFrom: token('color.azul.500'),
  bgTo: token('color.azul.700'),
  bone: token('color.noite.0'),
  joint: token('color.turquesa.300'),
  jointRing: token('color.azul.700'),
};

/**
 * Mão em L numa caixa de 100 x 100 (centro em 50, 50). `k` escala o desenho em torno do centro.
 * Indicador: base (31, 75) até a ponta (31, 21). Polegar: base (31, 75) até a ponta (69, 75).
 */
function hand(k) {
  const joints = [
    [31, 21], [31, 48], // indicador: ponta e articulação
    [31, 75], // base (onde o polegar encontra o indicador)
    [50, 75], [69, 75], // polegar: articulação e ponta
  ];
  const t = (x, y) => [50 + (x - 50) * k, 50 + (y - 50) * k];
  const [ax, ay] = t(31, 21);
  const [bx, by] = t(31, 75);
  const [cx, cy] = t(69, 75);
  const w = 10 * k;
  const r = 5.4 * k;
  const ring = 1.8 * k;
  return [
    `<path d="M${ax} ${ay}L${bx} ${by}L${cx} ${cy}" fill="none" stroke="${C.bone}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`,
    ...joints.map(([x, y]) => {
      const [px, py] = t(x, y);
      return `<circle cx="${px}" cy="${py}" r="${r}" fill="${C.joint}" stroke="${C.jointRing}" stroke-width="${ring}"/>`;
    }),
  ].join('');
}

/** SVG 100 x 100. `rounded`: cantos arredondados (ícone "any" e favicon); senão, fundo até a borda. */
function svg({ rounded, k }) {
  const rx = rounded ? 22 : 0;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0" stop-color="${C.bgFrom}"/><stop offset="1" stop-color="${C.bgTo}"/>`,
    '</linearGradient></defs>',
    `<rect width="100" height="100" rx="${rx}" fill="url(#g)"/>`,
    hand(k),
    '</svg>',
  ].join('');
}

// Zona segura do maskable: círculo de raio 40 no centro. O canto mais distante do desenho
// (ponta do indicador com o ponto) fica a ~40 do centro com k = 1; com k = 0.8, a ~32.
const SVG_ANY = svg({ rounded: true, k: 1 });
const SVG_FULL = svg({ rounded: false, k: 0.8 });
const SVG_APPLE = svg({ rounded: false, k: 0.9 });

writeFileSync(resolve(OUT, 'favicon.svg'), `${SVG_ANY}\n`);

let sharp;
try {
  // Procura o sharp nos node_modules do web-poc (o script mora fora dele)
  sharp = createRequire(resolve(ROOT, 'apps/web-poc/package.json'))('sharp');
} catch {
  console.error('sharp não encontrado: rode "npm install --no-save sharp" em apps/web-poc e repita. Só o favicon.svg foi gerado.');
  process.exit(1);
}

const png = (source, size, file) =>
  sharp(Buffer.from(source), { density: (72 * size) / 100 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(resolve(OUT, file));

await png(SVG_ANY, 192, 'icon-192.png');
await png(SVG_ANY, 512, 'icon-512.png');
await png(SVG_FULL, 512, 'icon-maskable-512.png');
await png(SVG_APPLE, 180, 'apple-touch-icon.png');

console.log(`Ícones do PWA em ${relative(ROOT, OUT)}: favicon.svg, icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png`);
