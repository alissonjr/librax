#!/usr/bin/env node
// Gerador de tokens do Librax (Node puro, sem dependências).
//
// Lê docs/design-tokens.json (formato DTCG) e gera, para o app web:
//   apps/web-poc/src/styles/tokens.css  CSS custom properties: claro, escuro por
//                                       prefers-color-scheme e por [data-theme]
//   apps/web-poc/src/styles/tokens.ts   valores para JS (canvas da câmera, háptica, som, durações)
//
// Uso:
//   node tools/tokens/build.mjs           gera os arquivos
//   node tools/tokens/build.mjs --check   não grava; falha (exit 1) se os gerados estiverem desatualizados
//
// Regras de nome (seção 3 da proposta): cada token vira --lx-<caminho-em-kebab>.
// Os tokens de theme.light / theme.dark perdem o prefixo de modo:
// theme.light.feedback.success.strong -> --lx-feedback-success-strong.
// Grupos fora de theme com filhos light/dark (ex.: elevation) ganham também um
// alias sem o modo que troca junto com o tema: --lx-elevation-2.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = resolve(ROOT, 'docs/design-tokens.json');
const OUT_DIR = resolve(ROOT, 'apps/web-poc/src/styles');
const OUT_CSS = resolve(OUT_DIR, 'tokens.css');
const OUT_TS = resolve(OUT_DIR, 'tokens.ts');
const CHECK = process.argv.includes('--check');

const T = JSON.parse(readFileSync(SRC, 'utf8'));

// ---------- leitura do DTCG ----------

const get = (path) => {
  const node = path.split('.').reduce((n, k) => (n == null ? undefined : n[k]), T);
  if (!node || !('$value' in node)) throw new Error(`Alias inexistente: {${path}}`);
  return node;
};

/** Resolve aliases {grupo.token}, inclusive dentro de arrays e objetos. */
const resolveValue = (v, seen = new Set()) => {
  if (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) {
    const path = v.slice(1, -1);
    if (seen.has(path)) throw new Error(`Alias circular: {${path}}`);
    return resolveValue(get(path).$value, new Set([...seen, path]));
  }
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, seen));
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, seen)]));
  }
  return v;
};

/** Percorre um grupo herdando $type e devolve [{ path, type, value }]. */
const walk = (node, path = [], type) => {
  const t = node.$type ?? type;
  return Object.entries(node).flatMap(([k, v]) => {
    if (k.startsWith('$') || typeof v !== 'object' || v === null) return [];
    if ('$value' in v) return [{ path: [...path, k], type: v.$type ?? t, value: resolveValue(v.$value) }];
    return walk(v, [...path, k], t);
  });
};

// ---------- conversão para CSS ----------

const kebab = (parts) =>
  parts
    .join('-')
    .replace(/_/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

const pxToRem = (px) => {
  const n = parseFloat(px);
  return `${+(n / 16).toFixed(4)}rem`;
};

const family = (list) => list.map((n) => (/[\s]/.test(n) ? `"${n}"` : n)).join(', ');

/** Valor CSS de um token, ou null quando o token não tem forma CSS (vai só para o tokens.ts). */
const cssValue = ({ type, value }) => {
  switch (type) {
    case 'cubicBezier':
      return `cubic-bezier(${value.join(', ')})`;
    case 'fontFamily':
      return family(value);
    case 'shadow':
      return value.map((s) => `${s.offsetX} ${s.offsetY} ${s.blur} ${s.spread} ${s.color}`).join(', ');
    case 'typography': {
      // A largura (font-stretch) entra no atalho "font" só como palavra-chave (semi-expanded, expanded)
      const stretch = value.fontStretch && value.fontStretch !== 'normal' ? ` ${value.fontStretch}` : '';
      return `${value.fontWeight}${stretch} ${pxToRem(value.fontSize)}/${value.lineHeight} ${family(value.fontFamily)}`;
    }
    default:
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        // molas (motion.spring.*): no web viram a duração equivalente
        return value.webDuration ?? null;
      }
      if (Array.isArray(value)) return null;
      return String(value);
  }
};

/** Linhas "--lx-x: v;" de uma lista de tokens. */
const lines = (list, indent, strip = 0) => {
  const out = [];
  for (const t of list) {
    const name = kebab(t.path.slice(strip));
    const v = cssValue(t);
    if (v === null) continue;
    out.push(`${indent}--lx-${name}: ${v};`);
    if (t.type === 'typography') {
      // Partes da tipografia, para quando o shorthand "font" não serve
      out.push(`${indent}--lx-${name}-size: ${pxToRem(t.value.fontSize)};`);
      out.push(`${indent}--lx-${name}-weight: ${t.value.fontWeight};`);
      out.push(`${indent}--lx-${name}-line-height: ${t.value.lineHeight};`);
      out.push(`${indent}--lx-${name}-tracking: ${t.value.letterSpacing ?? '0px'};`);
      out.push(`${indent}--lx-${name}-stretch: ${t.value.fontStretch ?? 'normal'};`);
    }
  }
  return out.join('\n');
};

const EXCLUDE_CSS = new Set(['theme', 'haptic', 'sound']);
const all = walk(T);
const globals = all.filter((t) => !EXCLUDE_CSS.has(t.path[0]));
const light = walk(T.theme.light);
const dark = walk(T.theme.dark);

// Grupos fora de theme com variantes por modo (ex.: elevation.light.1 / elevation.dark.1)
const modeAliases = (mode) =>
  globals
    .filter((t) => t.path[1] === mode)
    .map((t) => {
      const alias = kebab([t.path[0], ...t.path.slice(2)]);
      return `--lx-${alias}: var(--lx-${kebab(t.path)});`;
    });

const lightBlock = [lines(light, '  '), ...modeAliases('light').map((l) => `  ${l}`), '  color-scheme: light;'].join('\n');
const darkBlock = (indent) =>
  [lines(dark, indent), ...modeAliases('dark').map((l) => `${indent}${l}`), `${indent}color-scheme: dark;`].join('\n');

const HEADER = 'Gerado de docs/design-tokens.json por tools/tokens/build.mjs. Não editar à mão.';

const css = `/* ${HEADER} */

/* Tokens globais (iguais nos dois modos): primitivos, palco, ligas, tipografia, espaço, motion */
:root {
${lines(globals, '  ')}
}

/* Modo claro (padrão) */
:root {
${lightBlock}
}

/* Modo escuro escolhido no app */
:root[data-theme="dark"] {
${darkBlock('  ')}
}

/* Modo escuro do sistema, quando o app não força o claro */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${darkBlock('    ')}
  }
}
`;

// ---------- tokens.ts ----------

const flat = Object.fromEntries(all.map((t) => [t.path.join('.'), t.value]));
const ts = `// ${HEADER}
/* eslint-disable */

export const tokens = ${JSON.stringify(flat, null, 2)} as const;

export type TokenPath = keyof typeof tokens;
`;

// ---------- saída ----------

const outputs = [
  [OUT_CSS, css],
  [OUT_TS, ts],
];

if (CHECK) {
  const stale = outputs.filter(([file, content]) => !existsSync(file) || readFileSync(file, 'utf8') !== content);
  if (stale.length) {
    for (const [file] of stale) console.error(`Desatualizado: ${relative(ROOT, file)}`);
    console.error('Rode "npm run tokens" em apps/web-poc e inclua os arquivos gerados.');
    process.exit(1);
  }
  console.log('Tokens gerados estão em dia.');
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const [file, content] of outputs) writeFileSync(file, content);
  console.log(`Tokens: ${all.length} lidos de ${relative(ROOT, SRC)}`);
  for (const [file] of outputs) console.log(`  -> ${relative(ROOT, file)}`);
}
