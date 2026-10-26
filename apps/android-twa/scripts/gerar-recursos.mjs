#!/usr/bin/env node
// Recursos do app Android (TWA) tirados da marca e dos tokens do app web: abertura, notificação,
// cores e a ligação do ícone adaptativo.
//
// O ícone do app (a mão 3D fazendo joinha) é gerado junto com os do PWA por
// tools/pwa/build-icons.mjs, que grava os PNG em app/src/main/res/mipmap-<densidade>/ e o ícone da
// Play Store em loja/. Aqui ficam a abertura e a notificação, com o símbolo da marca: o L de Librax
// traçado como um movimento, em tangerina sobre grafite, com o ponto branco onde o movimento
// começa. A geometria abaixo é copiada de lá (caixa de 64 x 64); se a marca mudar, mude nos dois.
//
// Gera em app/src/main/res/:
//   values/colors.xml                      cores dos tokens (barra de status, navegação e abertura)
//   drawable/ic_notification_icon.xml      ícone pequeno das notificações (branco, vetor)
//   mipmap-anydpi-v26/ic_launcher*.xml     ícone adaptativo: fundo, frente e monocromático (PNG do joinha)
//   drawable-<densidade>/splash.png        símbolo da abertura, sobre a cor brand.icon.bg
//
// Uso (em apps/android-twa):
//   node scripts/gerar-recursos.mjs
//   (cd ../web-poc && npm run pwa-icons)   o ícone do app, se a mão ou o fundo mudarem
// A conversão para PNG usa o sharp, que não é dependência do projeto. Se faltar:
//   npm install --prefix /tmp/sharp sharp && NODE_PATH=/tmp/sharp/node_modules node scripts/gerar-recursos.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(HERE, '../..');
const TOKENS = resolve(ROOT, 'apps/web-poc/src/styles/tokens.ts');

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
  light: token('theme.light.bg.canvas'),
  dark: token('theme.dark.bg.canvas'),
};

/** Geometria do símbolo na caixa de 64 x 64 (a mesma do BrandMark e do favicon.svg). */
const GEOMETRY = {
  trace: 'M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0',
  tip: 'M37.0 36.5L52.0 46.0L37.0 55.5z',
  dot: [20, 12.5, 5],
};
const STROKE = 6.5;

const write = (file, text) => {
  const path = resolve(HERE, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return relative(HERE, path);
};

/* ---------- vetores (VectorDrawable) ---------- */

const circlePath = ([cx, cy, r]) => `M${cx - r},${cy}a${r},${r} 0,1 0,${2 * r},0a${r},${r} 0,1 0,${-2 * r},0z`;

/** Símbolo como VectorDrawable (notificação: só a silhueta, o sistema pinta). */
function vector({ size, viewport, color }) {
  const g = GEOMETRY;
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/gerar-recursos.mjs (marca do Librax, tokens do app web). Não editar à mão. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
    <path
        android:pathData="${g.trace}"
        android:strokeColor="${color}"
        android:strokeWidth="${STROKE}"
        android:strokeLineCap="round" />
    <path
        android:pathData="${g.tip}"
        android:fillColor="${color}"
        android:strokeColor="${color}"
        android:strokeWidth="2"
        android:strokeLineJoin="round" />
    <path
        android:pathData="${circlePath(g.dot)}"
        android:fillColor="${color}" />
</vector>
`;
}

const files = [];
files.push(write('app/src/main/res/drawable/ic_notification_icon.xml', vector({ size: 24, viewport: 64, color: '#FFFFFFFF' })));

// Ícone adaptativo: as três camadas são PNG por densidade (tools/pwa/build-icons.mjs)
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/gerar-recursos.mjs; as camadas vêm de tools/pwa/build-icons.mjs. Não editar à mão. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
files.push(write('app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml', adaptive));
files.push(write('app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml', adaptive));

files.push(write('app/src/main/res/values/colors.xml', `<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/gerar-recursos.mjs a partir de apps/web-poc/src/styles/tokens.ts. Não editar à mão. -->
<resources>
    <!-- theme.light.bg.canvas: barra de status e de navegação (o theme_color do manifesto web) -->
    <color name="colorPrimary">${C.light}</color>
    <!-- theme.dark.bg.canvas: as mesmas barras com o aparelho no tema escuro -->
    <color name="colorPrimaryDark">${C.dark}</color>
    <color name="navigationColor">${C.light}</color>
    <color name="navigationColorDark">${C.dark}</color>
    <color name="navigationDividerColor">${C.light}</color>
    <color name="navigationDividerColorDark">${C.dark}</color>
    <!-- brand.icon.bg: fundo da abertura (o background_color do manifesto web), o mesmo do ícone -->
    <color name="backgroundColor">${C.bg}</color>
</resources>
`));

/* ---------- PNG da abertura (sharp) ---------- */

function svg() {
  const g = GEOMETRY;
  const [cx, cy, r] = g.dot;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `<path d="${g.trace}" fill="none" stroke="${C.mark}" stroke-width="${STROKE}" stroke-linecap="round"/>`,
    `<path d="${g.tip}" fill="${C.mark}" stroke="${C.mark}" stroke-width="2" stroke-linejoin="round"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.dot}"/>`,
    '</svg>',
  ].join('');
}

let sharp;
try {
  sharp = createRequire(resolve(ROOT, 'apps/web-poc/package.json'))('sharp');
} catch {
  console.error('sharp não encontrado (ver o topo deste arquivo). Só os vetores e as cores foram gerados:');
  for (const f of files) console.error(`  ${f}`);
  process.exit(1);
}

// mdpi = 1x. Abertura: 128 dp (o Chrome mostra no centro, sem esticar).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  const size = 128 * k;
  const path = resolve(HERE, `app/src/main/res/drawable-${name}/splash.png`);
  mkdirSync(dirname(path), { recursive: true });
  await sharp(Buffer.from(svg()), { density: Math.ceil((72 * size) / 64) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path);
  files.push(relative(HERE, path));
}

console.log(`Recursos do app Android (${files.length} arquivos):`);
for (const f of files) console.log(`  ${f}`);
