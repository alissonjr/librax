import privacidade from './privacidade.md?raw';
import termos from './termos.md?raw';
import { RESPONSAVEL, type ResponsavelKey } from './responsavel';
import { ROUTES } from '../lib/routes';

/**
 * Política de Privacidade e Termos de Uso (abertos sem login, em /privacidade e /termos).
 *
 * Os textos ficam em Markdown nesta pasta (privacidade.md e termos.md), só em português, com a versão
 * e a data de vigência no cabeçalho. Mudou o texto, sobe a versão e a data. Os dados de quem responde
 * pelo app vêm de responsavel.ts ({{nome}}, {{documento}}, {{email}}, {{foro}}).
 *
 * O Markdown aceito é o mínimo que os textos usam, lido aqui sem biblioteca:
 * - `## título` (seção, entra no índice) e `### título` (subseção);
 * - parágrafo (linhas seguidas) e lista com `- `;
 * - `**negrito**`, `[texto](endereço)` e as chaves `{{...}}` dentro do texto.
 */

export type LegalDocId = 'privacy' | 'terms';

export type LegalBlock =
  | { type: 'section'; id: string; text: string }
  | { type: 'subsection'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] };

export interface LegalDoc {
  id: LegalDocId;
  path: string;
  /** Chave de i18n do título (o texto em si é só em português). */
  titleKey: string;
  version: string;
  /** Data de vigência ('AAAA-MM-DD'). */
  effectiveDate: string;
  blocks: LegalBlock[];
}

export type InlinePart =
  | { type: 'text'; text: string }
  | { type: 'strong'; parts: InlinePart[] }
  | { type: 'link'; href: string; parts: InlinePart[] }
  | { type: 'responsavel'; key: ResponsavelKey; value: string };

/** Id de âncora a partir do título ("9. Transferência internacional" -> "9-transferencia-internacional"). */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Separa o cabeçalho (`versao:` e `vigencia:` entre linhas `---`) do corpo. */
export function parseFrontMatter(source: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) return { meta: {}, body: source };
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: source.slice(match[0].length) };
}

/** Blocos do corpo em Markdown (o subconjunto descrito no topo). */
export function parseBlocks(body: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    if (list) blocks.push({ type: 'list', items: list });
    paragraph = [];
    list = null;
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith('### ')) {
      flush();
      blocks.push({ type: 'subsection', text: line.slice(4).trim() });
    } else if (line.startsWith('## ')) {
      flush();
      const text = line.slice(3).trim();
      blocks.push({ type: 'section', id: slugify(text), text });
    } else if (line.startsWith('- ')) {
      if (paragraph.length) flush();
      list ??= [];
      list.push(line.slice(2).trim());
    } else if (list) {
      // Linha seguinte de um item longo
      list[list.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|\{\{(\w+)\}\}/g;

function isResponsavelKey(key: string): key is ResponsavelKey {
  return Object.prototype.hasOwnProperty.call(RESPONSAVEL, key);
}

/** Texto de um bloco em partes: negrito, links e os dados de responsavel.ts. */
export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ type: 'text', text: text.slice(last, index) });
    if (m[1] !== undefined) {
      parts.push({ type: 'strong', parts: parseInline(m[1]) });
    } else if (m[2] !== undefined) {
      parts.push({ type: 'link', href: m[3], parts: parseInline(m[2]) });
    } else if (isResponsavelKey(m[4])) {
      parts.push({ type: 'responsavel', key: m[4], value: RESPONSAVEL[m[4]] });
    } else {
      // Chave desconhecida: aparece como está, para ser notada e corrigida
      parts.push({ type: 'text', text: m[0] });
    }
    last = index + m[0].length;
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) });
  return parts;
}

function load(id: LegalDocId, path: string, titleKey: string, source: string): LegalDoc {
  const { meta, body } = parseFrontMatter(source);
  return {
    id,
    path,
    titleKey,
    version: meta.versao ?? '',
    effectiveDate: meta.vigencia ?? '',
    blocks: parseBlocks(body),
  };
}

export const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  privacy: load('privacy', ROUTES.privacy, 'legal.privacyTitle', privacidade),
  terms: load('terms', ROUTES.terms, 'legal.termsTitle', termos),
};
