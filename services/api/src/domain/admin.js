// Acesso ao painel de administracao (docs/painel-admin.md).
//
// So entra quem esta no grupo `admin` do Cognito. O grupo vem no id token (`cognito:groups`) e o
// autorizador JWT do API Gateway HTTP API repassa a claim como texto: um grupo vira "[admin]" e
// varios viram "[admin editores]". Testes e outras bordas podem mandar a lista de verdade ou o
// JSON dela; todas as formas sao aceitas.

export const ADMIN_GROUP = 'admin';
/**
 * Dono do painel: so quem esta neste grupo (alem do `admin`) promove ou tira alguem do admin, e mexe
 * em conta de outro admin. Entra pelo script (lancar-cloudshell.sh --dono), nunca pelo painel.
 */
export const OWNER_GROUP = 'owner';

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

// --- grupos de agora (nao os do token) -----------------------------------------------------------
//
// O id token guarda os grupos de quando a pessoa entrou e vale 1 hora: tirar alguem do admin so
// valeria quando o token vencesse. Por isso o painel le os grupos da conta no Cognito
// (AdminListGroupsForUser) e guarda so a lista com `admin` por pouco tempo; sem `admin`, le de novo.

/** Por quanto tempo os grupos de quem e admin ficam guardados na Lambda (tirar do admin vale em ate isso). */
export const GROUPS_CACHE_MS = 60 * 1000;

/**
 * @param {(username: string) => Promise<string[]>} read  le os grupos da conta
 * @returns {{get: (username: string) => Promise<string[]>, forget: (username: string) => void}}
 */
export function makeGroupsGate(read, { ttlMs = GROUPS_CACHE_MS, now = () => Date.now() } = {}) {
  const cached = new Map();
  return {
    async get(username) {
      const hit = cached.get(username);
      if (hit && hit.until > now()) return hit.groups;
      const groups = await read(username);
      if (groups.includes(ADMIN_GROUP)) cached.set(username, { groups, until: now() + ttlMs });
      else cached.delete(username);
      return groups;
    },
    forget: (username) => cached.delete(username),
  };
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

// --- segundo fator de quem abre o painel ---------------------------------------------------------
//
// O Cognito nao exige MFA por grupo, e o token do User Pool nao diz como a pessoa entrou (nao tem
// `amr`). O que da para conferir com seguranca e a conta: com o aplicativo autenticador ligado
// (UserMFASettingList tem SOFTWARE_TOKEN_MFA), todo login dela pede o codigo, inclusive no login
// hospedado do Cognito que o painel usa. A Lambda le isso com AdminGetUser e guarda so o "sim" por
// alguns minutos; o "nao" nunca fica guardado, para o painel abrir logo depois da configuracao.

/** Conta federada (Google, Apple): o id token traz `identities`. O fator do Cognito nao vale para ela. */
export function isFederated(claims = {}) {
  const raw = claims.identities;
  return raw !== undefined && raw !== null && raw !== '' && raw !== '[]';
}

/** Por quanto tempo o "autenticador ligado" fica guardado na Lambda (desligar leva ate isso para valer). */
export const MFA_CACHE_MS = 5 * 60 * 1000;

/**
 * @param {(username: string) => Promise<boolean>} check  le a conta (AdminGetUser)
 * @returns {(username: string) => Promise<boolean>}
 */
export function makeMfaGate(check, { ttlMs = MFA_CACHE_MS, now = () => Date.now() } = {}) {
  const enabledUntil = new Map();
  return async (username) => {
    const until = enabledUntil.get(username);
    if (until !== undefined && until > now()) return true;
    const enabled = await check(username);
    if (enabled) enabledUntil.set(username, now() + ttlMs);
    else enabledUntil.delete(username);
    return enabled;
  };
}
