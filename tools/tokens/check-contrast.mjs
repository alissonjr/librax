#!/usr/bin/env node
// Verificação de contraste WCAG 2.x dos tokens do Librax (Node puro, sem dependências).
//
// Lê docs/design-tokens.json e calcula a razão de contraste de cada par da seção 4.5
// da proposta (docs/design-system-proposta.md). Cores com transparência são compostas
// sobre o fundo antes do cálculo; no palco, o pior caso é vídeo totalmente branco.
// Mínimos: 4,5:1 para texto e 3:1 para componentes e gráficos (WCAG 1.4.11).
//
// Uso: node tools/tokens/check-contrast.mjs [--verbose]
// Sai com código 1 se algum par ficar abaixo do mínimo (para o CI reprovar o PR).

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const T = JSON.parse(readFileSync(resolve(ROOT, 'docs/design-tokens.json'), 'utf8'));
const VERBOSE = process.argv.includes('--verbose');

const TEXT = 4.5;
const UI = 3;

// ---------- leitura ----------

const node = (path) => path.split('.').reduce((n, k) => (n == null ? undefined : n[k]), T);
const value = (path) => {
  let v = node(path)?.$value;
  if (v === undefined) throw new Error(`Token inexistente: ${path}`);
  while (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) v = node(v.slice(1, -1))?.$value;
  return v;
};

// ---------- cor ----------

/** "#RGB", "#RRGGBB" ou "#RRGGBBAA" -> { r, g, b, a } (0..255, a 0..1) */
const parse = (hex) => {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) throw new Error(`Cor inválida: ${hex}`);
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
};

/** Compõe uma cor (com alfa) sobre um fundo opaco. */
const over = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (fg, bg) => {
  const opaque = fg.a < 1 ? over(fg, bg) : fg;
  const [l1, l2] = [luminance(opaque), luminance(bg)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// ---------- pares ----------

const results = [];
const check = (group, label, fg, bg, min) => {
  const r = ratio(fg, bg);
  results.push({ group, label, ratio: r, min, ok: r >= min - 1e-9 });
};

const WHITE = parse('#FFFFFF');

// Tema: o mesmo conjunto de pares no claro e no escuro
for (const mode of ['light', 'dark']) {
  const c = (p) => parse(value(`theme.${mode}.${p}`));
  const backgrounds = ['bg.canvas', 'bg.surface', 'bg.raised'];
  const worstBg = (label, fgPath, min) => {
    for (const bg of backgrounds) check(mode, `${label} / ${bg}`, c(fgPath), c(bg), min);
  };

  for (const p of [
    'text.primary', 'text.secondary', 'text.tertiary', 'text.brand',
    'feedback.success.text', 'feedback.error.text', 'feedback.warning.text', 'feedback.info.text',
    'game.xp.text', 'game.streak.text', 'game.hand.text',
    'game.trace.text', 'brand.ink',
  ]) worstBg(p, p, TEXT);

  for (const p of [
    'border.strong', 'border.focus', 'action.primary.bg',
    'feedback.success.strong', 'feedback.error.strong',
    'game.xp.fill', 'game.streak.fill', 'game.hand.fill',
    'game.trace.fill', 'game.progress', 'brand.mark',
  ]) worstBg(`${p} (não texto)`, p, UI);

  const pairs = [
    ['text.tertiary', 'bg.sunken', TEXT],
    ['text.inverse', 'bg.inverse', TEXT],
    ['action.primary.fg', 'action.primary.bg', TEXT],
    ['action.primary.fg', 'action.primary.bgPressed', TEXT],
    ['action.secondary.fg', 'action.secondary.bg', TEXT],
    ['action.danger.fg', 'action.danger.bg', TEXT],
    ['feedback.success.onStrong', 'feedback.success.strong', TEXT],
    ['feedback.error.onStrong', 'feedback.error.strong', TEXT],
    ['feedback.warning.onStrong', 'feedback.warning.strong', TEXT],
    ['feedback.info.onStrong', 'feedback.info.strong', TEXT],
    ['feedback.success.onSoft', 'feedback.success.soft', TEXT],
    ['feedback.error.onSoft', 'feedback.error.soft', TEXT],
    ['feedback.warning.onSoft', 'feedback.warning.soft', TEXT],
    ['feedback.info.onSoft', 'feedback.info.soft', TEXT],
    ['game.xp.text', 'game.xp.soft', TEXT],
    ['game.streak.text', 'game.streak.soft', TEXT],
    ['game.hand.text', 'game.hand.soft', TEXT],
    ['text.primary', 'game.locked.bg', TEXT],
    ['game.locked.fg', 'game.locked.bg', UI],
    ['game.progress', 'game.track', UI],
    ['game.xp.fill', 'game.track', UI],
    // Combinações usadas pelo web-poc além da tabela 4.5
    ['text.secondary', 'bg.sunken', TEXT], // texto de apoio em área recuada
    ['text.brand', 'feedback.info.soft', TEXT], // aba ativa e linha "Você" no ranking
    ['text.primary', 'feedback.info.soft', TEXT], // alternativa/opção selecionada
    ['feedback.success.strong', 'feedback.success.soft', UI], // borda e ícone da alternativa correta
    ['feedback.error.strong', 'feedback.error.soft', UI], // borda e ícone da alternativa incorreta
    // Traço: elementos de assinatura e marca
    ['game.hand.onFill', 'game.hand.fill', UI], // ícone sobre o nó concluído do mapa
    ['game.trace.onSoft', 'game.trace.soft', TEXT], // legenda da demonstração e chips de glosa
    ['game.trace.text', 'game.trace.soft', TEXT], // texto em tangerina sobre o fundo da demonstração
    ['game.trace.fill', 'game.trace.soft', UI], // seta de trajetória sobre o fundo da demonstração
    ['text.primary', 'game.trace.soft', TEXT], // mão desenhada e botão Ver o movimento (grafite) sobre a demonstração
    ['bg.canvas', 'text.primary', TEXT], // texto do botão Ver o movimento
    ['game.progress', 'game.trace.soft', UI],
    ['game.locked.fg', 'bg.surface', UI], // cadeado do nó bloqueado (fundo surface com anel)
  ];
  for (const [fg, bg, min] of pairs) check(mode, `${fg} / ${bg}${min === UI ? ' (não texto)' : ''}`, c(fg), c(bg), min);
}

// Palco: igual nos dois modos, sempre escuro
{
  const s = (p) => parse(value(`stage.${p}`));
  const stageBg = s('bg');
  const scrimOnWhite = over(s('scrim'), WHITE);
  const pillOnWhite = over(s('pill'), WHITE);
  const haloOnWhite = over(s('landmark.halo'), WHITE);

  check('stage', 'stage.text / scrim sobre vídeo branco', s('text'), scrimOnWhite, TEXT);
  check('stage', 'stage.textSecondary / scrim sobre vídeo branco', s('textSecondary'), scrimOnWhite, TEXT);
  check('stage', 'stage.text / pill sobre vídeo branco', s('text'), pillOnWhite, TEXT);
  check('stage', 'stage.textSecondary / pill sobre vídeo branco', s('textSecondary'), pillOnWhite, TEXT);
  check('stage', 'stage.text / stage.bg', s('text'), stageBg, TEXT);
  check('stage', 'stage.textSecondary / stage.bg', s('textSecondary'), stageBg, TEXT);

  for (const lm of ['idle', 'tracking', 'ready', 'correct', 'retry', 'reference']) {
    check('stage', `landmark.${lm} / halo sobre vídeo branco (não texto)`, s(`landmark.${lm}`), haloOnWhite, UI);
    check('stage', `landmark.${lm} / stage.bg (não texto)`, s(`landmark.${lm}`), stageBg, UI);
  }
  check('stage', 'stage.gold / stage.bg (não texto)', s('gold'), stageBg, UI);
  // Traço: seta de trajetória e cartão de acerto sobre o palco
  const stageSurface = s('surface');
  check('stage', 'stage.trace / stage.bg (não texto)', s('trace'), stageBg, UI);
  check('stage', 'stage.trace / stage.surface (não texto)', s('trace'), stageSurface, UI);
  check('stage', 'stage.text / stage.surface', s('text'), stageSurface, TEXT);
  check('stage', 'stage.textSecondary / stage.surface', s('textSecondary'), stageSurface, TEXT);
  check('stage', 'landmark.correct / stage.surface', s('landmark.correct'), stageSurface, TEXT);
  check('stage', 'stage.gold / stage.surface (+XP)', s('gold'), stageSurface, TEXT);
  for (const g of ['idle', 'ok', 'warn']) {
    check('stage', `guide.${g} / stage.bg (não texto)`, s(`guide.${g}`), stageBg, UI);
  }
}

// Ligas: cor nunca sozinha, mas o contraste precisa passar
{
  const lightSurface = parse(value('theme.light.bg.surface'));
  const darkSurface = parse(value('theme.dark.bg.surface'));
  for (const name of Object.keys(T.league).filter((k) => !k.startsWith('$'))) {
    const l = (p) => parse(value(`league.${name}.${p}`));
    check('liga', `${name}: onFill / fill`, l('onFill'), l('fill'), TEXT);
    check('liga', `${name}: edge / surface claro (não texto)`, l('edge'), lightSurface, UI);
    check('liga', `${name}: fill / surface escuro (não texto)`, l('fill'), darkSurface, UI);
  }
}

// Ícone do app e favicon (fixos)
{
  const b = (p) => parse(value(`brand.icon.${p}`));
  for (const bg of ['bg', 'bgDark']) {
    check('marca', `brand.icon.mark / ${bg} (não texto)`, b('mark'), b(bg), UI);
    check('marca', `brand.icon.dot / ${bg} (não texto)`, b('dot'), b(bg), UI);
    check('marca', `brand.icon.skin / ${bg} (não texto)`, b('skin'), b(bg), UI);
  }
}

// ---------- relatório ----------

const failed = results.filter((r) => !r.ok);
if (VERBOSE || failed.length) {
  for (const r of VERBOSE ? results : failed) {
    const mark = r.ok ? 'ok  ' : 'FALHA';
    console.log(`${mark} [${r.group}] ${r.label}: ${r.ratio.toFixed(2)} (mínimo ${r.min})`);
  }
}
console.log(`Contraste: ${results.length} pares verificados, ${failed.length} reprovados.`);
process.exit(failed.length ? 1 : 0);
