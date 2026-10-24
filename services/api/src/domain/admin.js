// Acesso ao painel de administracao (docs/painel-admin.md).
//
// So entra quem esta no grupo `admin` do Cognito. O grupo vem no id token (`cognito:groups`) e o
// autorizador JWT do API Gateway HTTP API repassa a claim como texto: um grupo vira "[admin]" e
// varios viram "[admin editores]". Testes e outras bordas podem mandar a lista de verdade ou o
// JSON dela; todas as formas sao aceitas.

export const ADMIN_GROUP = 'admin';

/** Lista de grupos da claim `cognito:groups`, em qualquer das formas acima. */
export function groupsOf(claims = {}) {
  const raw = claims['cognito:groups'];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== 'string') return [];
  const text = raw.trim();
  if (text.startsWith('[') && text.includes('"')) {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return text
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .filter(Boolean);
}

export function isAdmin(claims) {
  return groupsOf(claims).includes(ADMIN_GROUP);
}

/** Busca de conta: e-mail (ou o comeco dele) ou o sub do Cognito. */
export const ACCOUNT_QUERY_MIN = 3;
export const ACCOUNT_QUERY_MAX = 128;
const SUB_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normaliza o termo de busca de conta. `kind` diz como o diretorio procura: `sub` (igual) ou
 * `email` (comeca com). Aspas e barras saem: o termo vai para um filtro do ListUsers.
 * @returns {{ok: true, value: {kind: 'sub'|'email', term: string}} | {ok: false, error: string}}
 */
export function parseAccountQuery(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'BAD_QUERY' };
  const term = raw.trim().replace(/["\\]/g, '');
  if (term.length < ACCOUNT_QUERY_MIN || term.length > ACCOUNT_QUERY_MAX) return { ok: false, error: 'BAD_QUERY' };
  if (SUB_RE.test(term)) return { ok: true, value: { kind: 'sub', term: term.toLowerCase() } };
  return { ok: true, value: { kind: 'email', term: term.toLowerCase() } };
}

/** Id de usuario no caminho (`/v1/admin/accounts/{userId}`): o sub do Cognito. */
export function isUserId(value) {
  return typeof value === 'string' && SUB_RE.test(value);
}
