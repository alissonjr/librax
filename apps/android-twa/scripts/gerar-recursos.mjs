#!/usr/bin/env node
// Recursos do app Android (TWA) tirados da marca e dos tokens do app web: ícones, splash e cores.
//
// O desenho é o mesmo dos ícones do PWA (tools/pwa/build-icons.mjs): o L de Librax traçado como um
// movimento, em tangerina sobre grafite, com o ponto branco onde o movimento começa. A geometria
// abaixo é copiada de lá (caixa de 64 x 64); se a marca mudar, mude nos dois.
//
// Gera em app/src/main/res/ (e em loja/):
//   values/colors.xml                      cores dos tokens (barra de status, navegação e splash)
//   drawable/ic_launcher_foreground.xml    camada da frente do ícone adaptativo (vetor, Android 8+)
//   drawable/ic_launcher_monochrome.xml    ícone temático (Android 13+), uma cor só
//   drawable/ic_notification_icon.xml      ícone pequeno das notificações (branco, vetor)
//   mipmap-anydpi-v26/ic_launcher*.xml     ícone adaptativo: fundo da marca + frente + monocromático
//   mipmap-<densidade>/ic_launcher*.png    ícone para Android 7 e anteriores (quadrado e redondo)
//   drawable-<densidade>/splash.png        símbolo da abertura, sobre a cor brand.icon.bg
//   loja/icone-play-512.png                ícone da página na Play Store (512 x 512, sem transparência)
//
// Uso (em apps/android-twa):
//   node scripts/gerar-recursos.mjs
// A conversão para PNG usa o sharp, que não é dependência do projeto. Se faltar:
//   npm install --prefix /tmp/sharp sharp && NODE_PATH=/tmp/sharp/node_modules node scripts/gerar-recursos.mjs

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(HERE, '../..');
const RES = resolve(HERE, 'app/src/main/res');
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

/** Geometria do símbolo na caixa de 64 x 64 (tools/pwa/build-icons.mjs). */
const GEOMETRY = {
  normal: {
    trace: 'M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0',
    tip: 'M37.0 36.5L52.0 46.0L37.0 55.5z',
    dot: [20, 12.5, 5],
  },
  // Cabe no círculo de raio 40% do centro (zona segura do maskable)
  safe: {
    trace: 'M22.6 23.4V32.7Q22.6 42.9 32.7 42.9H37.4',
    tip: 'M35.9 35.5L47.6 42.9L35.9 50.3z',
    dot: [22.6, 16.8, 3.9],
  },
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

/**
 * Símbolo como VectorDrawable. Ícone adaptativo: caixa de 108 dp, e só o círculo central de 66 dp é
 * garantido em todas as máscaras; a geometria "safe" (raio 25.6 na caixa de 64) vai para raio 33.
 */
function vector({ size, viewport, scale = 1, translate = 0, geometry = 'safe', mark, dot }) {
  const g = GEOMETRY[geometry];
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/gerar-recursos.mjs (marca do Librax, tokens do app web). Não editar à mão. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${size}dp"
    android:height="${size}dp"
    android:viewportWidth="${viewport}"
    android:viewportHeight="${viewport}">
    <group
        android:scaleX="${scale}"
        android:scaleY="${scale}"
        android:translateX="${translate}"
        android:translateY="${translate}">
        <path
            android:pathData="${g.trace}"
            android:strokeColor="${mark}"
            android:strokeWidth="${STROKE}"
            android:strokeLineCap="round" />
        <path
            android:pathData="${g.tip}"
            android:fillColor="${mark}"
            android:strokeColor="${mark}"
            android:strokeWidth="2"
            android:strokeLineJoin="round" />
        <path
            android:pathData="${circlePath(g.dot)}"
            android:fillColor="${dot}" />
    </group>
</vector>
`;
}

const ADAPTIVE_SCALE = +(33 / 25.6).toFixed(4);
const ADAPTIVE_TRANSLATE = +((108 - 64 * ADAPTIVE_SCALE) / 2).toFixed(3);

const files = [];
files.push(write('app/src/main/res/drawable/ic_launcher_foreground.xml', vector({
  size: 108, viewport: 108, scale: ADAPTIVE_SCALE, translate: ADAPTIVE_TRANSLATE, mark: C.mark, dot: C.dot,
})));
files.push(write('app/src/main/res/drawable/ic_launcher_monochrome.xml', vector({
  size: 108, viewport: 108, scale: ADAPTIVE_SCALE, translate: ADAPTIVE_TRANSLATE, mark: '#FFFFFFFF', dot: '#FFFFFFFF',
})));
// Notificação: 24 dp, só a silhueta (o sistema pinta)
files.push(write('app/src/main/res/drawable/ic_notification_icon.xml', vector({
  size: 24, viewport: 64, geometry: 'normal', mark: '#FFFFFFFF', dot: '#FFFFFFFF',
})));

const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<!-- Gerado por scripts/gerar-recursos.mjs. Não editar à mão. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
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
    <!-- brand.icon.bg: fundo da abertura (o background_color do manifesto web) e do ícone -->
    <color name="backgroundColor">${C.bg}</color>
    <color name="iconBackground">${C.bg}</color>
</resources>
`));

/* ---------- PNG (sharp) ---------- */

function svg({ shape, geometry = 'normal', withBackground = true }) {
  const g = GEOMETRY[geometry];
  const [cx, cy, r] = g.dot;
  const bg = !withBackground
    ? ''
    : shape === 'circle'
      ? `<circle cx="32" cy="32" r="32" fill="${C.bg}"/>`
      : `<rect width="64" height="64" rx="${shape === 'rounded' ? 18 : 0}" fill="${C.bg}"/>`;
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    bg,
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

const png = async (source, size, file, opts = {}) => {
  const path = resolve(HERE, file);
  mkdirSync(dirname(path), { recursive: true });
  let img = sharp(Buffer.from(source), { density: Math.ceil((72 * size) / 64) }).resize(size, size);
  if (opts.flatten) img = img.flatten({ background: C.bg });
  await img.png({ compressionLevel: 9 }).toFile(path);
  files.push(relative(HERE, path));
};

// mdpi = 1x. Ícone: 48 dp. Splash: 128 dp (o Chrome mostra no centro, sem esticar).
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  await png(svg({ shape: 'rounded' }), 48 * k, `app/src/main/res/mipmap-${name}/ic_launcher.png`);
  await png(svg({ shape: 'circle', geometry: 'safe' }), 48 * k, `app/src/main/res/mipmap-${name}/ic_launcher_round.png`);
  await png(svg({ shape: 'square', withBackground: false }), 128 * k, `app/src/main/res/drawable-${name}/splash.png`);
}
// Play Store: quadrado cheio, sem transparência (a loja arredonda sozinha)
await png(svg({ shape: 'square' }), 512, 'loja/icone-play-512.png', { flatten: true });

console.log(`Recursos do app Android (${files.length} arquivos):`);
for (const f of files) console.log(`  ${f}`);
