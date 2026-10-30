import { callApi, sessionUserId, type ApiCall } from './sync';
import { getDisplayName, setDisplayName } from './auth';

/**
 * Liga geral e ligas privadas, lidas do servidor (só com conta).
 *
 * - Liga geral: todo mundo com conta, pelo XP total de sempre (GET /v1/ranking/global). Quem não
 *   quer aparecer desliga em Configurações (PUT /v1/users/me/profile, showInGlobalRanking).
 * - Ligas privadas: são as squads privadas do servidor (spec-04), com outro nome no app. Quem
 *   cria recebe um código de 6 letras; os outros entram pelo código ou pelo link /convite/<código>.
 *   O ranking tem duas abas: XP da semana (zera toda segunda) e XP desde que a pessoa entrou.
 */

// ---------- liga geral ----------

export interface GlobalRow {
  rank: number;
  name: string | null;
  xp: number;
  isYou: boolean;
}

export interface GlobalRanking {
  top: GlobalRow[];
  you: { rank: number | null; xp: number; listed: boolean };
}

export type Load<T> = { kind: 'ok'; data: T } | { kind: 'guest' } | { kind: 'offline' };

function asLoad<T>(res: ApiCall<unknown>, valid: (d: unknown) => d is T): Load<T> {
  if (res.kind === 'guest') return { kind: 'guest' };
  if (res.kind === 'ok' && valid(res.data)) return { kind: 'ok', data: res.data };
  return { kind: 'offline' };
}

const isGlobal = (d: unknown): d is GlobalRanking => {
  const o = d as Partial<GlobalRanking> | null;
  return !!o && Array.isArray(o.top) && !!o.you && typeof o.you.xp === 'number';
};

export async function fetchGlobalRanking(): Promise<Load<GlobalRanking>> {
  return asLoad(await callApi<unknown>('GET', '/v1/ranking/global', { flush: true }), isGlobal);
}

// ---------- perfil público (nome e liga geral) ----------

const NAME_SENT_KEY = 'librax_nameSent';
const SHOW_GLOBAL_KEY = 'librax_showInGlobalRanking';
/** Nome trocado em Configurações que ainda não chegou ao servidor (sem rede na hora). */
const NAME_PENDING_KEY = 'librax_namePending';

/** Tamanho do nome depois da limpeza (o mesmo das boas-vindas e do servidor, domain/profile.js). */
export const DISPLAY_NAME_MAX = 30;

/** Nome como o servidor guarda: sem espaços nas pontas nem repetidos. Vazio: null. */
export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, ' ').trim();
  return name && [...name].length <= DISPLAY_NAME_MAX ? name : null;
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* sem localStorage: manda de novo na próxima vez, o servidor só regrava */
  }
}

type ProfileReply = { displayName?: unknown; showInGlobalRanking?: unknown };

/** Guarda o que o servidor respondeu: o nome que vale para a conta e a escolha da liga geral. */
function rememberProfile(data: ProfileReply | null | undefined, fallbackName: string): void {
  const name = typeof data?.displayName === 'string' && data.displayName ? data.displayName : fallbackName;
  if (name !== getDisplayName()) setDisplayName(name);
  writeKey(NAME_SENT_KEY, name);
  if (typeof data?.showInGlobalRanking === 'boolean') writeKey(SHOW_GLOBAL_KEY, String(data.showInGlobalRanking));
}

/**
 * Envio automático do nome (na abertura com conta e ao entrar), uma vez por nome. Se a conta já
 * tem um nome, o da conta vale (`keepExistingName`) e vem para o aparelho: entrar num aparelho novo
 * nunca troca o nome escolhido antes. Um nome trocado em Configurações sem rede vai agora e grava.
 */
export async function syncDisplayName(): Promise<void> {
  const name = getDisplayName()?.trim();
  if (!name) return;
  const pending = readKey(NAME_PENDING_KEY) === name;
  if (!pending && readKey(NAME_SENT_KEY) === name) return;
  const res = await callApi<ProfileReply>('PUT', '/v1/users/me/profile', {
    body: pending ? { displayName: name } : { displayName: name, keepExistingName: true },
  });
  if (res.kind !== 'ok') return;
  if (pending) writeKey(NAME_PENDING_KEY, null);
  rememberProfile(res.data, name);
}

export type RenameResult = 'saved' | 'local' | 'pending';

/**
 * Troca o nome (Configurações). Vale na hora neste aparelho; com conta, vai para o servidor, que
 * leva o nome novo para as ligas. Sem conta: 'local'. Sem rede: 'pending' (vai na próxima abertura).
 */
export async function renameDisplayName(raw: string): Promise<RenameResult | null> {
  const name = cleanName(raw);
  if (!name) return null;
  setDisplayName(name);
  // Sem conta, fica só no aparelho (nada pendente: ao entrar numa conta, o nome dela vale)
  if (!(await sessionUserId())) return 'local';
  const res = await callApi<ProfileReply>('PUT', '/v1/users/me/profile', { body: { displayName: name } });
  if (res.kind === 'guest') return 'local';
  if (res.kind === 'ok') {
    writeKey(NAME_PENDING_KEY, null);
    rememberProfile(res.data, name);
    return 'saved';
  }
  writeKey(NAME_PENDING_KEY, name);
  return 'pending';
}

/** Saída da conta: a próxima conta recebe o nome de novo e a escolha da liga geral volta ao padrão. */
export function forgetAccountSocial(): void {
  try {
    localStorage.removeItem(NAME_SENT_KEY);
    localStorage.removeItem(NAME_PENDING_KEY);
    localStorage.removeItem(SHOW_GLOBAL_KEY);
  } catch {
    /* sem localStorage */
  }
}

/** Escolha guardada neste aparelho (o servidor é quem vale; começa ligada, como lá). */
export function showInGlobalRanking(): boolean {
  return readKey(SHOW_GLOBAL_KEY) !== 'false';
}

/** Aparecer ou não na liga geral. Devolve o valor que ficou no servidor, ou null se não deu. */
export async function setShowInGlobalRanking(show: boolean): Promise<boolean | null> {
  const res = await callApi<{ showInGlobalRanking?: boolean }>('PUT', '/v1/users/me/profile', {
    body: { showInGlobalRanking: show },
  });
  if (res.kind !== 'ok') return null;
  const saved = res.data?.showInGlobalRanking ?? show;
  try {
    localStorage.setItem(SHOW_GLOBAL_KEY, String(saved));
  } catch {
    /* sem localStorage: o interruptor volta a mostrar "ligado" na próxima vez */
  }
  return saved;
}

// ---------- ligas privadas ----------

export interface PrivateLeague {
  squadId: string;
  name: string;
  memberCount: number;
  maxMembers: number;
  xpWeekly: number;
  /** Só para quem é membro. */
  inviteCode?: string;
}

export interface PrivateMember {
  userId: string;
  displayName?: string | null;
  role: 'admin' | 'member';
  xpWeeklyContrib?: number;
  xpAllTimeContrib?: number;
}

export interface PrivateLeagueDetail {
  squad: PrivateLeague;
  members: PrivateMember[];
  membersVisible: boolean;
  userMembership?: { role: 'admin' | 'member' } | null;
  /** userId da conta que pediu (para achar a própria linha); preenchido pelo app. */
  me?: string | null;
}

/** Limites das squads no servidor (spec-04 0.1). */
export const PRIVATE_LEAGUE_LIMIT = 5;
export const PRIVATE_LEAGUE_MAX_MEMBERS = 30;
export const PRIVATE_NAME_MIN = 3;
export const PRIVATE_NAME_MAX = 40;
export const INVITE_CODE_LENGTH = 6;

const isList = (d: unknown): d is { squads: PrivateLeague[] } => Array.isArray((d as { squads?: unknown } | null)?.squads);
const isDetail = (d: unknown): d is PrivateLeagueDetail => !!(d as PrivateLeagueDetail | null)?.squad?.squadId;
const isSquad = (d: unknown): d is PrivateLeague => typeof (d as PrivateLeague | null)?.squadId === 'string';

export async function fetchMyPrivateLeagues(): Promise<Load<PrivateLeague[]>> {
  const load = asLoad(await callApi<unknown>('GET', '/v1/users/me/squads'), isList);
  return load.kind === 'ok' ? { kind: 'ok', data: load.data.squads } : load;
}

export async function fetchPrivateLeague(id: string): Promise<Load<PrivateLeagueDetail> | { kind: 'missing' }> {
  const res = await callApi<unknown>('GET', `/v1/squads/${encodeURIComponent(id)}`, { flush: true });
  if (res.kind === 'error' && res.status === 404) return { kind: 'missing' };
  const load = asLoad(res, isDetail);
  return load.kind === 'ok' ? { kind: 'ok', data: { ...load.data, me: await sessionUserId() } } : load;
}

/** Resultado de uma ação: ok, ou o código de erro do servidor ('offline' sem rede, 'guest' sem conta). */
export type Action<T> = { ok: true; data: T } | { ok: false; code: string };

function asAction<T>(res: ApiCall<unknown>, valid: (d: unknown) => d is T): Action<T> {
  if (res.kind === 'ok' && valid(res.data)) return { ok: true, data: res.data };
  if (res.kind === 'error') return { ok: false, code: res.code ?? 'ERROR' };
  if (res.kind === 'guest') return { ok: false, code: 'GUEST' };
  return { ok: false, code: 'OFFLINE' };
}

const anything = (d: unknown): d is unknown => true;

export async function createPrivateLeague(name: string): Promise<Action<PrivateLeague>> {
  return asAction(await callApi('POST', '/v1/squads', { body: { name: name.trim(), type: 'private' } }), isSquad);
}

/** Código em maiúsculas, só letras e números (o servidor guarda assim). */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, INVITE_CODE_LENGTH);
}

export async function joinPrivateLeague(code: string): Promise<Action<PrivateLeague>> {
  return asAction(await callApi('POST', '/v1/squads/join', { body: { inviteCode: normalizeInviteCode(code) } }), isSquad);
}

export async function leavePrivateLeague(id: string): Promise<Action<unknown>> {
  return asAction(await callApi('POST', `/v1/squads/${encodeURIComponent(id)}/leave`), anything);
}

export async function deletePrivateLeague(id: string): Promise<Action<unknown>> {
  return asAction(await callApi('DELETE', `/v1/squads/${encodeURIComponent(id)}`), anything);
}

export async function newInviteCode(id: string): Promise<Action<{ inviteCode: string }>> {
  return asAction(
    await callApi('POST', `/v1/squads/${encodeURIComponent(id)}/invite-code/regenerate`),
    (d): d is { inviteCode: string } => typeof (d as { inviteCode?: unknown } | null)?.inviteCode === 'string',
  );
}

// ---------- convite ----------

/** Link do convite no endereço do app (abre direto na tela de entrar com o código). */
export function inviteLink(code: string, origin: string = window.location.origin): string {
  return `${origin}/convite/${encodeURIComponent(code)}`;
}

/** Link do WhatsApp com a mensagem pronta (a pessoa escolhe o contato ou o grupo). */
export function whatsappLink(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Compartilhar pelo menu do aparelho (WhatsApp, Telegram, e-mail...). Sem Web Share, copia o texto.
 * Devolve 'shared', 'copied' ou 'failed' (a pessoa fechou o menu também conta como 'shared').
 */
export async function shareInvite(text: string, url: string): Promise<'shared' | 'copied' | 'failed'> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ text, url });
      return 'shared';
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return 'shared';
    }
  }
  return (await copyText(`${text} ${url}`)) ? 'copied' : 'failed';
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const PENDING_INVITE_KEY = 'librax_pendingInvite';

/** Código de um link de convite aberto antes das boas-vindas ou sem conta: fica guardado até usar. */
export function savePendingInvite(code: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, normalizeInviteCode(code));
  } catch {
    /* sem localStorage: a pessoa digita o código */
  }
}

export function pendingInvite(): string | null {
  try {
    const code = localStorage.getItem(PENDING_INVITE_KEY);
    return code && code.length === INVITE_CODE_LENGTH ? code : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    /* sem localStorage */
  }
}
