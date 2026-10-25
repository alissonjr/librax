#!/usr/bin/env node
// Extrai os ícones usados pelo web-poc do pacote @material-symbols/svg-500 (estilo Rounded,
// licença Apache 2.0) e grava só os caminhos SVG em apps/web-poc/src/icons/symbols.ts.
// Assim o app não carrega fonte de ícones nem o pacote inteiro: cada ícone vira um <path>.
//
// Para usar um ícone novo: acrescente o nome em ICONS e rode "npm run icons" em apps/web-poc.
// Nomes: https://fonts.google.com/icons (Material Symbols).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PKG = resolve(ROOT, 'apps/web-poc/node_modules/@material-symbols/svg-500/rounded');
const OUT = resolve(ROOT, 'apps/web-poc/src/icons/symbols.ts');

const ICONS = [
  // abas (seção 8 da proposta)
  'school', 'sign_language', 'group', 'person',
  // jogo
  'local_fire_department', 'bolt', 'military_tech', 'trophy', 'ac_unit', 'flag', 'trending_up',
  // câmera
  'videocam', 'videocam_off', 'light_mode',
  // estados de lição e feedback
  'lock', 'check', 'check_circle', 'play_arrow', 'pause', 'replay', 'close', 'lightbulb', 'skip_next',
  'arrow_upward', 'arrow_downward',
  // navegação e ações
  'arrow_back', 'arrow_forward', 'chevron_right', 'settings', 'language', 'download', 'delete',
  'share', 'shield', 'info', 'warning', 'drag_indicator', 'progress_activity', 'contrast',
  // demonstração do sinal (vídeo ou avatar VLibras)
  'speed', 'cloud_off',
  // ligas (LeagueTimer) e som (Configurações)
  'schedule', 'volume_up', 'volume_off',
  // instalação do app (tela inicial)
  'mobile_arrow_down', 'ios_share', 'add_box',
  // página de teste da câmera (W0) e ferramenta de coleta
  'content_copy', 'timer', 'stop', 'swap_horiz', 'memory', 'restart_alt', 'fiber_manual_record',
  // conta (entrar, criar conta, sair) e sequência (histórico)
  'login', 'logout', 'mail', 'cloud_done', 'visibility', 'visibility_off', 'history',
  // Termos de Uso (Configurações); a Política de Privacidade usa o shield
  'description',
  // Desempenho da câmera (Configurações)
  'query_stats',
];

// Ícones que também precisam da variante preenchida (aba ativa e ícones de jogo em destaque).
const FILLED = new Set([
  'school', 'sign_language', 'group', 'person',
  'local_fire_department', 'bolt', 'military_tech', 'trophy', 'check_circle', 'lightbulb', 'lock',
  'play_arrow', 'warning', 'info', 'mobile_arrow_down',
]);

const pathOf = (file) => {
  const svg = readFileSync(file, 'utf8');
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  const paths = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (viewBox !== '0 -960 960 960' || paths.length === 0) {
    throw new Error(`SVG inesperado em ${file} (viewBox ${viewBox}, ${paths.length} paths)`);
  }
  return paths.join(' ');
};

if (!existsSync(PKG)) {
  console.error('Pacote @material-symbols/svg-500 não encontrado. Rode "npm install" em apps/web-poc.');
  process.exit(1);
}

const entries = ICONS.map((name) => {
  const outline = pathOf(resolve(PKG, `${name}.svg`));
  if (!FILLED.has(name)) return `  ${name}: {\n    outline: '${outline}',\n  },`;
  const fill = pathOf(resolve(PKG, `${name}-fill.svg`));
  return `  ${name}: {\n    outline: '${outline}',\n    fill: '${fill}',\n  },`;
});

const ts = `// Gerado por tools/icons/build.mjs a partir de @material-symbols/svg-500 (Rounded, Apache 2.0).
// Não editar à mão: acrescente o ícone em tools/icons/build.mjs e rode "npm run icons".
/* eslint-disable */

export const SYMBOLS: Record<string, { outline: string; fill?: string }> = {
${entries.join('\n')}
};

export type IconName =\n${ICONS.map((n) => `  | '${n}'`).join('\n')};
`;

writeFileSync(OUT, ts);
console.log(`Ícones: ${ICONS.length} -> ${relative(ROOT, OUT)}`);
