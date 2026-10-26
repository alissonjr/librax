#!/usr/bin/env node
// Ícones do Librax: a mão 3D do app fazendo joinha (punho fechado, polegar para cima; em Libras é
// "joia/legal" e o número 1 do curso), renderizada no Blender, sobre o fundo da marca.
//
// A imagem-mestra (tools/pwa/icone-joinha.png, fundo transparente) sai de
// apps/landing/scripts/mao3d/joinha.py; este script recorta, monta o fundo e gera todos os
// tamanhos. A palavra-marca e o símbolo (BrandMark, o Traço) continuam no resto do app: abertura,
// cabeçalhos, landing e vídeo. O favicon.svg (o símbolo) continua sendo gerado porque o admin e a
// tela de login local usam ele como logo; o favicon das páginas agora é o joinha (ICO e PNG).
//
// Gera em apps/web-poc/public/:
//   favicon.ico             16, 32 e 48 px (o joinha num quadrado arredondado)
//   favicon-32.png          idem, 32 px
//   favicon-48.png          idem, 48 px
//   icon-192.png            ícone "any" (quadrado arredondado, cantos transparentes)
//   icon-512.png            idem
//   icon-maskable-512.png   ícone "maskable": fundo até a borda e a mão dentro do círculo de 80%
//   apple-touch-icon.png    180 x 180, fundo até a borda (o iOS arredonda sozinho)
//   favicon.svg             o símbolo da marca (Traço), vetorial, para quem usa como logo
// E em apps/android-twa/:
//   app/src/main/res/mipmap-<densidade>/ic_launcher.png            Android 7 e anteriores (quadrado)
//   app/src/main/res/mipmap-<densidade>/ic_launcher_round.png      idem, redondo
//   app/src/main/res/mipmap-<densidade>/ic_launcher_foreground.png ícone adaptativo (Android 8+): frente
//   app/src/main/res/mipmap-<densidade>/ic_launcher_background.png ícone adaptativo: fundo
//   app/src/main/res/mipmap-<densidade>/ic_launcher_monochrome.png ícone temático (Android 13+): silhueta
//   loja/icone-play-512.png                                        ícone da Play Store (sem transparência)
//
// Uso (em apps/web-poc):
//   npm run pwa-icons
//   npm run pwa-icons -- --mestre /tmp/joinha.png   importa um render novo do joinha.py (recorta e
//                                                   reduz para tools/pwa/icone-joinha.png) e gera tudo
// A conversão usa o sharp, que não é dependência do projeto. Se faltar:
//   npm install --no-save sharp && npm run pwa-icons

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TOKENS = resolve(ROOT, 'apps/web-poc/src/styles/tokens.ts');
const WEB = resolve(ROOT, 'apps/web-poc/public');
const TWA = resolve(ROOT, 'apps/android-twa');
const MESTRE = resolve(ROOT, 'tools/pwa/icone-joinha.png');
/** Lado maior da imagem-mestra guardada no repositório (o maior ícone tem 512 px). */
const MESTRE_LADO = 1200;

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

/* ---------- favicon.svg: o símbolo da marca (Traço), usado como logo ---------- */

// Geometria do símbolo na caixa de 64 x 64 (estudo/marca/traco.html, a mesma do BrandMark), com o
// traço grosso do tamanho mínimo (16 a 24 px)
const SVG_SIMBOLO = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
  `<rect width="64" height="64" rx="18" fill="${C.bg}"/>`,
  `<path d="M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0" fill="none" stroke="${C.mark}" stroke-width="8" stroke-linecap="round"/>`,
  `<path d="M37.0 36.5L52.0 46.0L37.0 55.5z" fill="${C.mark}" stroke="${C.mark}" stroke-width="2" stroke-linejoin="round"/>`,
  `<circle cx="20" cy="12.5" r="6" fill="${C.dot}"/>`,
  '</svg>',
].join('');

let sharp;
try {
  // Procura o sharp nos node_modules do web-poc (o script mora fora dele)
  sharp = createRequire(resolve(ROOT, 'apps/web-poc/package.json'))('sharp');
} catch {
  console.error('sharp não encontrado: rode "npm install --no-save sharp" em apps/web-poc e repita.');
  process.exit(1);
}

const files = [];
const save = async (img, path) => {
  mkdirSync(dirname(path), { recursive: true });
  await img.png({ compressionLevel: 9 }).toFile(path);
  files.push(relative(ROOT, path));
};
writeFileSync(resolve(WEB, 'favicon.svg'), `${SVG_SIMBOLO}\n`);
files.push(relative(ROOT, resolve(WEB, 'favicon.svg')));

/* ---------- imagem-mestra ---------- */

/** Caixa (x0, y0, x1, y1) dos pixels com alfa acima do limiar. */
function alphaBox({ data, info }, limiar = 8) {
  const { width: w, height: h, channels: ch } = info;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * ch + ch - 1] > limiar) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) throw new Error('imagem-mestra vazia (sem pixels opacos)');
  return { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

const mestreArg = process.argv.indexOf('--mestre');
if (mestreArg > 0) {
  // Render novo: recorta na mão (com folga de 2%) e reduz para o tamanho guardado no repositório
  const src = process.argv[mestreArg + 1];
  const raw = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = alphaBox(raw);
  const pad = Math.round(0.02 * Math.max(b.x1 - b.x0, b.y1 - b.y0));
  const left = Math.max(0, b.x0 - pad);
  const top = Math.max(0, b.y0 - pad);
  const width = Math.min(raw.info.width, b.x1 + pad) - left;
  const height = Math.min(raw.info.height, b.y1 + pad) - top;
  const k = Math.min(1, MESTRE_LADO / Math.max(width, height));
  await save(
    sharp(src).extract({ left, top, width, height }).resize(Math.round(width * k), Math.round(height * k), { kernel: 'lanczos3' }),
    MESTRE,
  );
}

const mestre = await sharp(MESTRE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const MW = mestre.info.width;
const MH = mestre.info.height;
const caixa = alphaBox(mestre);

/**
 * Menor círculo que contém a mão (aproximado numa grade): centro e raio em pixels da mestra. É o
 * que vale para as zonas seguras do maskable e do ícone adaptativo, que são círculos.
 */
function circuloDaMao() {
  const { data } = mestre;
  const pts = [];
  const passo = Math.max(1, Math.round(Math.max(MW, MH) / 300));
  for (let y = 0; y < MH; y += passo) {
    for (let x = 0; x < MW; x += passo) {
      if (data[(y * MW + x) * 4 + 3] > 24) pts.push([x, y]);
    }
  }
  const raio = (cx, cy) => {
    let r2 = 0;
    for (const [x, y] of pts) r2 = Math.max(r2, (x - cx) ** 2 + (y - cy) ** 2);
    return Math.sqrt(r2);
  };
  let best = { cx: (caixa.x0 + caixa.x1) / 2, cy: (caixa.y0 + caixa.y1) / 2 };
  best.r = raio(best.cx, best.cy);
  // Descida em grade: passos cada vez menores em volta do melhor centro
  for (let d = Math.max(MW, MH) / 8; d >= 1; d /= 2) {
    let melhorou = true;
    while (melhorou) {
      melhorou = false;
      for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
        const r = raio(best.cx + dx, best.cy + dy);
        if (r < best.r - 1e-6) {
          best = { cx: best.cx + dx, cy: best.cy + dy, r };
          melhorou = true;
        }
      }
    }
  }
  return best;
}
const circulo = circuloDaMao();

/* ---------- composição ---------- */

/** Fundo da marca: cor única (brand.icon.bg) com uma luz bem leve atrás da mão. */
function fundoSvg(size, forma) {
  const s = size;
  const clip =
    forma === 'circle'
      ? `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}"/>`
      : `<rect width="${s}" height="${s}" rx="${forma === 'rounded' ? s * 0.22 : 0}"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
      '<defs><radialGradient id="g" cx="0.5" cy="0.42" r="0.62">' +
      `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.07"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>` +
      `</radialGradient><clipPath id="c">${clip}</clipPath></defs>` +
      `<g clip-path="url(#c)"><rect width="${s}" height="${s}" fill="${C.bg}"/><rect width="${s}" height="${s}" fill="url(#g)"/></g>` +
      '</svg>',
  );
}

/**
 * Camada da mão numa tela quadrada transparente de `size` px.
 * `modo: 'caixa'`: a caixa da mão ocupa `frac` do lado (pelo lado maior), centrada.
 * `modo: 'circulo'`: o círculo que contém a mão tem raio `frac` do lado, centrado.
 */
async function camadaMao(size, { modo, frac, nitidez = false, parte = [0, 0, 1, 1] }) {
  let k, cx, cy;
  if (modo === 'circulo') {
    k = (frac * size) / circulo.r;
    cx = circulo.cx;
    cy = circulo.cy;
  } else {
    // `parte`: o pedaço da caixa (frações) que deve caber; o resto (o pulso) sai pela borda
    const [fx0, fy0, fx1, fy1] = parte;
    const bw = caixa.x1 - caixa.x0;
    const bh = caixa.y1 - caixa.y0;
    const x0 = caixa.x0 + fx0 * bw, x1 = caixa.x0 + fx1 * bw;
    const y0 = caixa.y0 + fy0 * bh, y1 = caixa.y0 + fy1 * bh;
    k = (frac * size) / Math.max(x1 - x0, y1 - y0);
    cx = (x0 + x1) / 2;
    cy = (y0 + y1) / 2;
  }
  // A mestra reduzida inteira e recortada na tela (a composição não aceita posição negativa)
  const w = Math.max(1, Math.round(MW * k));
  const h = Math.max(1, Math.round(MH * k));
  let mao = sharp(MESTRE).resize(w, h, { kernel: 'lanczos3' });
  if (nitidez) mao = mao.sharpen({ sigma: 0.5 });
  const left = Math.round(size / 2 - cx * k);
  const top = Math.round(size / 2 - cy * k);
  const buf = await mao.png().toBuffer();
  const pad = Math.max(w, h) + size;
  const tela = await sharp({ create: { width: size + 2 * pad, height: size + 2 * pad, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: buf, left: left + pad, top: top + pad }])
    .png()
    .toBuffer();
  return sharp(tela).extract({ left: pad, top: pad, width: size, height: size }).png().toBuffer();
}

/** Sombra de contato: a silhueta escurecida, borrada e um pouco abaixo. */
async function sombra(maoBuf, size) {
  const { data, info } = await sharp(maoBuf).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 4) out[i + 3] = Math.round(data[i + 3] * 0.55);
  const sigma = Math.max(0.5, size * 0.018);
  const dy = Math.round(size * 0.02);
  const borrada = await sharp(out, { raw: info }).blur(sigma).png().toBuffer();
  return { input: borrada, left: 0, top: dy };
}

async function icone(size, { forma, modo, frac, nitidez = false, parte, comSombra = true }) {
  const mao = await camadaMao(size, { modo, frac, nitidez, parte });
  const camadas = comSombra && size >= 64 ? [await sombra(mao, size)] : [];
  camadas.push({ input: mao });
  const base = sharp(fundoSvg(size, forma)).resize(size, size);
  let img = sharp(await base.composite(camadas).png().toBuffer());
  if (forma !== 'square') {
    // Corta a sombra e a mão no contorno do fundo (cantos transparentes)
    const mask = await sharp(fundoSvg(size, forma)).resize(size, size).png().toBuffer();
    img = sharp(await img.composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer());
  }
  return img;
}

/**
 * Silhueta branca da mão (ícone temático do Android 13+), na mesma posição da frente adaptativa.
 * As frestas escuras entre os dedos (bem abaixo da luz média da pele) viram vazado, para o punho
 * continuar parecendo dedos dobrados e não um bloco.
 */
const FRESTA = 0.5;
async function silhueta(size, opts) {
  const mao = await camadaMao(size, opts);
  const { data, info } = await sharp(mao).raw().toBuffer({ resolveWithObject: true });
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const ls = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) ls.push(lum(i));
  ls.sort((a, b) => a - b);
  const mediana = ls[Math.floor(ls.length / 2)] ?? 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    // Na fresta, a transição de 0 a 1 vai de 0,75 a 1 vez o limiar (borda suave, sem serrilhado)
    const f = Math.min(1, Math.max(0, (lum(i) / (FRESTA * mediana) - 0.75) / 0.25));
    data[i] = data[i + 1] = data[i + 2] = 255;
    // Bordas firmes, sem o semitransparente do antisserrilhado virar névoa no tema
    data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (a - 0.3) / 0.4)) * (a > 0.9 ? f : 1));
  }
  return sharp(data, { raw: info });
}

/** ICO com PNG dentro (aceito por todos os navegadores atuais). */
async function ico(sizes, path) {
  const pngs = [];
  for (const s of sizes) pngs.push(await (await icone(s, FAVICON)).png({ compressionLevel: 9 }).toBuffer());
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach((png, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e);
    head.writeUInt8(sizes[i] >= 256 ? 0 : sizes[i], e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8);
    head.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  writeFileSync(path, Buffer.concat([head, ...pngs]));
  files.push(relative(ROOT, path));
}

/* ---------- tamanhos ---------- */

// Favicon (16 a 48 px): punho e polegar quase até a borda, o pulso sai pela direita, e um pouco
// mais nítido
const FAVICON = { forma: 'rounded', modo: 'caixa', frac: 0.92, nitidez: true, parte: [0, 0, 0.8, 1] };
// "any": quadrado arredondado, a mão com folga
const ANY = { forma: 'rounded', modo: 'caixa', frac: 0.8 };
// Fundo até a borda (iOS e Play Store arredondam sozinhos)
const CHEIO = { forma: 'square', modo: 'caixa', frac: 0.78 };
// Maskable: zona segura é o círculo de raio 40% no centro; a mão fica com raio 38,5%
const MASKABLE = { forma: 'square', modo: 'circulo', frac: 0.385 };
// Adaptativo (108 dp): só o círculo de 66 dp (raio 33) é garantido em todas as máscaras
const ADAPTATIVO = { modo: 'circulo', frac: 32 / 108 };
// Ícones antigos do Android (48 dp com 2 dp de folga)
const LEGADO = { forma: 'rounded', modo: 'caixa', frac: 0.74 };
const LEGADO_REDONDO = { forma: 'circle', modo: 'circulo', frac: 0.4 };

await ico([16, 32, 48], resolve(WEB, 'favicon.ico'));
await save(await icone(32, FAVICON), resolve(WEB, 'favicon-32.png'));
await save(await icone(48, FAVICON), resolve(WEB, 'favicon-48.png'));
await save(await icone(192, ANY), resolve(WEB, 'icon-192.png'));
await save(await icone(512, ANY), resolve(WEB, 'icon-512.png'));
await save(await icone(512, MASKABLE), resolve(WEB, 'icon-maskable-512.png'));
await save(await icone(180, CHEIO), resolve(WEB, 'apple-touch-icon.png'));

/** Ícone legado de 48 dp: o desenho em 44 dp, centrado (2 dp de folga como os do sistema). */
async function legado(size, opts) {
  const inner = Math.round((size * 44) / 48);
  const img = await (await icone(inner, opts)).png().toBuffer();
  const off = Math.floor((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: img, left: off, top: off }]);
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [name, k] of Object.entries(DENSITIES)) {
  const dir = resolve(TWA, `app/src/main/res/mipmap-${name}`);
  await save(await legado(48 * k, LEGADO), resolve(dir, 'ic_launcher.png'));
  await save(await legado(48 * k, LEGADO_REDONDO), resolve(dir, 'ic_launcher_round.png'));
  const a = 108 * k;
  const frente = await camadaMao(a, ADAPTATIVO);
  const vazio = { create: { width: a, height: a, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } };
  await save(sharp(vazio).composite([await sombra(frente, a), { input: frente }]), resolve(dir, 'ic_launcher_foreground.png'));
  await save(sharp(fundoSvg(a, 'square')).resize(a, a), resolve(dir, 'ic_launcher_background.png'));
  await save(await silhueta(a, ADAPTATIVO), resolve(dir, 'ic_launcher_monochrome.png'));
}
// Play Store: quadrado cheio, sem transparência (a loja arredonda sozinha)
await save((await icone(512, CHEIO)).flatten({ background: C.bg }), resolve(TWA, 'loja/icone-play-512.png'));

console.log(`Ícones (${files.length} arquivos), da mestra ${relative(ROOT, MESTRE)} (${MW} x ${MH}):`);
for (const f of files) console.log(`  ${f}`);
