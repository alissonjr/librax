// Regras puras de squads/equipes (SPEC 04 secoes 0 e 2).
// Guardas de decisao; a persistencia fica nos usecases sobre o repositorio.

export const MAX_SQUADS_PER_USER = 5;
export const DEFAULT_MAX_MEMBERS = 30;
export const NAME_MIN = 3;
export const NAME_MAX = 40;
export const DESCRIPTION_MAX = 200;
/** Tipos que o app cria e edita; `org` so vem do painel institucional (SPEC 04 secao 5.3). */
export const USER_SQUAD_TYPES = ['public', 'private'];

/** @returns {{ok: true} | {ok: false, error: string}} */
export function canCreateSquad({ isGuest, b2cSquadCount, name, type = 'public' }) {
  if (isGuest) return fail('GUEST_NOT_ALLOWED');
  if (b2cSquadCount >= MAX_SQUADS_PER_USER) return fail('SQUADS_LIMIT_REACHED');
  if (!isValidName(name)) return fail('INVALID_NAME');
  if (!USER_SQUAD_TYPES.includes(type)) return fail('INVALID_TYPE');
  return ok();
}

/**
 * `viaInvite`: entrou pelo codigo de convite. Por squadId direto so squad publica (SPEC 04
 * secao 2); privada ou de org responde como inexistente, para nao revelar que existe.
 * @returns {{ok: true} | {ok: false, error: string}}
 */
export function canJoinSquad({ isGuest, b2cSquadCount, squad, alreadyMember = false, viaInvite = true }) {
  if (isGuest) return fail('GUEST_NOT_ALLOWED');
  if (!viaInvite && squad.type !== 'public') return fail('SQUAD_NOT_FOUND');
  if (alreadyMember) return fail('ALREADY_MEMBER');
  if (squad.memberCount >= squad.maxMembers) return fail('SQUAD_FULL');
  // equipes de org nao contam no limite de 5 (SPEC 04 secao 0.2)
  if (squad.type !== 'org' && b2cSquadCount >= MAX_SQUADS_PER_USER) return fail('SQUADS_LIMIT_REACHED');
  return ok();
}

/**
 * Resultado de sair de uma squad.
 * @returns {{ok: true, action: 'dissolve'|'remove'} | {ok: false, error: string}}
 */
export function leaveOutcome({ isOnlyAdmin, memberCount }) {
  if (memberCount <= 1) return { ok: true, action: 'dissolve' };
  if (isOnlyAdmin) return fail('MUST_TRANSFER_OWNERSHIP');
  return { ok: true, action: 'remove' };
}

/**
 * Resultado de uma acao de admin sobre um membro.
 * @param {{action: 'promote'|'demote'|'kick', actorIsTarget: boolean, targetIsOnlyAdmin?: boolean}} input
 * @returns {{ok: true, role?: string, action?: string} | {ok: false, error: string}}
 */
export function manageMemberOutcome({ action, actorIsTarget, targetIsOnlyAdmin = false }) {
  if (actorIsTarget) return fail('CANNOT_MANAGE_SELF');
  switch (action) {
    case 'promote':
      return { ok: true, role: 'admin' };
    case 'demote':
      if (targetIsOnlyAdmin) return fail('CANNOT_DEMOTE_ONLY_ADMIN');
      return { ok: true, role: 'member' };
    case 'kick':
      return { ok: true, action: 'remove' };
    default:
      return fail('INVALID_ACTION');
  }
}

/**
 * Transferencia da administracao (POST /squads/{id}/transfer): o alvo vira admin e quem
 * transferiu vira membro (e pode sair em seguida, ver leaveOutcome).
 * @param {{actorRole: string|null, actorIsTarget: boolean, targetIsMember: boolean}} input
 * @returns {{ok: true, actorRole: 'member', targetRole: 'admin'} | {ok: false, error: string}}
 */
export function transferOwnershipOutcome({ actorRole, actorIsTarget, targetIsMember }) {
  if (actorRole !== 'admin') return fail('NOT_ADMIN');
  if (actorIsTarget) return fail('CANNOT_MANAGE_SELF');
  if (!targetIsMember) return fail('TARGET_NOT_MEMBER');
  return { ok: true, actorRole: 'member', targetRole: 'admin' };
}

/**
 * O que acontece com uma squad quando um membro exclui a conta (DELETE /v1/users/me). Segue o
 * leaveOutcome, sem o MUST_TRANSFER_OWNERSHIP: quem exclui a conta nao pode mais transferir.
 * - ninguem mais na squad: dissolve (como o unico membro que sai);
 * - era o unico admin: o membro mais antigo (joinedAt, desempate pelo userId) vira admin, o
 *   mesmo que o transferOwnership faria, e a squad continua para os outros;
 * - havia outro admin ou a pessoa era membro comum: so sai.
 * @param {{others: {userId: string, role?: string, joinedAt?: string|null}[]}} input  membros que ficam
 * @returns {{action: 'dissolve'} | {action: 'remove', promote: string|null}}
 */
export function accountDeletionOutcome({ others }) {
  if (others.length === 0) return { action: 'dissolve' };
  if (others.some((m) => m.role === 'admin')) return { action: 'remove', promote: null };
  // sem joinedAt (seeds antigos) fica por ultimo
  const key = (m) => `${m.joinedAt ?? '~'}#${m.userId}`;
  const [oldest] = [...others].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  return { action: 'remove', promote: oldest.userId };
}

/**
 * Valida a edicao da squad (PATCH /squads/{id}). So name, description, type e maxMembers
 * sao editaveis; o resto do corpo e ignorado. maxMembers fica entre o total atual e o
 * padrao de 30 (o admin pode reduzir, SPEC 04 secao 0.1).
 * @returns {{ok: true, changes: object} | {ok: false, error: string}}
 */
export function validateSquadChanges(squad, input) {
  const changes = {};
  const has = (key) => input != null && input[key] !== undefined;

  if (has('name')) {
    if (!isValidName(input.name)) return fail('INVALID_NAME');
    changes.name = input.name.trim();
  }
  if (has('description')) {
    if (typeof input.description !== 'string' || input.description.length > DESCRIPTION_MAX) {
      return fail('INVALID_DESCRIPTION');
    }
    changes.description = input.description;
  }
  if (has('type')) {
    if (squad.type === 'org' || !USER_SQUAD_TYPES.includes(input.type)) return fail('INVALID_TYPE');
    changes.type = input.type;
  }
  if (has('maxMembers')) {
    const max = input.maxMembers;
    if (!Number.isInteger(max) || max < 1 || max > DEFAULT_MAX_MEMBERS) return fail('INVALID_MAX_MEMBERS');
    if (max < squad.memberCount) return fail('MAX_MEMBERS_BELOW_COUNT');
    changes.maxMembers = max;
  }

  if (Object.keys(changes).length === 0) return fail('NO_CHANGES');
  return { ok: true, changes };
}

// --- XP semanal (SPEC 04 secao 0.3): reset toda segunda 00:00 UTC ---
//
// A squad (META) e cada membro guardam o XP da semana junto com a semana a que ele se refere
// (`xpWeekPeriod`, 'AAAA-wSS'). A primeira licao de uma semana nova vira a semana do item
// (o valor anterior vai para `lastWeekXp`/`lastWeekPeriod`) e o job semanal faz o mesmo para
// quem nao estudou. Assim o reset nunca apaga XP que ja entrou na semana nova.

/** XP semanal para mostrar na semana `period`: zero se o item ainda e de uma semana velha. */
export function currentWeekXp(value, itemPeriod, period) {
  return itemPeriod && itemPeriod !== period ? 0 : value ?? 0;
}

/** XP que o item fez na semana `period` (antes ou depois de virar a semana). */
export function weekXpOf(item, weeklyAttr, period) {
  if (item?.lastWeekPeriod === period) return item.lastWeekXp ?? 0;
  if (item?.xpWeekPeriod === period) return item[weeklyAttr] ?? 0;
  return 0;
}

/** Ranking interno da semana: XP desc, desempate por userId asc. */
export function rankSquadWeek(members) {
  return [...members]
    .sort((a, b) => b.xp - a.xp || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
    .map((m, i) => ({ userId: m.userId, xp: m.xp, rank: i + 1 }));
}

const WEEK_FIELDS = ['xpWeekPeriod', 'lastWeekXp', 'lastWeekPeriod'];

/** Squad (META) como a API devolve na semana `period`: XP semanal da semana, sem os campos internos. */
export function squadForWeek(squad, period) {
  const out = { ...squad, xpWeekly: currentWeekXp(squad.xpWeekly, squad.xpWeekPeriod, period) };
  for (const k of WEEK_FIELDS) delete out[k];
  return out;
}

/** Membro como a API devolve na semana `period`. */
export function memberForWeek(member, period) {
  const out = { ...member, xpWeeklyContrib: currentWeekXp(member.xpWeeklyContrib, member.xpWeekPeriod, period) };
  for (const k of WEEK_FIELDS) delete out[k];
  return out;
}

/** Campos da squad que qualquer pessoa autenticada pode ver (cabecalho e diretorio, SPEC 04 4.2 e 4.5). */
export const PUBLIC_SQUAD_FIELDS = ['squadId', 'name', 'description', 'type', 'memberCount', 'maxMembers', 'xpWeekly'];
/** Campos de membro no preview de squad publica (ranking sem dados de conta). */
const PREVIEW_MEMBER_FIELDS = ['userId', 'displayName', 'role', 'xpWeeklyContrib'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/**
 * Resposta do GET /squads/{id} para quem chama (SPEC 04 secoes 0.1, 2 e 4.2):
 * - membro: squad completa (com o convite, para compartilhar) e todos os membros;
 * - nao membro de squad publica (preview): dados publicos e o ranking, sem convite;
 * - nao membro de squad privada ou de org: so os dados publicos, sem membros.
 * Membros por XP da semana `period` desc; campos internos de semana ficam de fora.
 */
export function squadView({ squad, members, viewerId, period }) {
  const ranked = members
    .map((m) => memberForWeek(m, period))
    .sort((a, b) => (b.xpWeeklyContrib ?? 0) - (a.xpWeeklyContrib ?? 0));
  const me = ranked.find((m) => m.userId === viewerId) ?? null;
  const weekly = squadForWeek(squad, period);

  if (me) {
    return { squad: weekly, members: ranked, membersVisible: true, userMembership: { role: me.role } };
  }
  const visible = squad.type === 'public';
  return {
    squad: pick(weekly, PUBLIC_SQUAD_FIELDS),
    members: visible ? ranked.map((m) => pick(m, PREVIEW_MEMBER_FIELDS)) : [],
    membersVisible: visible,
    userMembership: null,
  };
}

function isValidName(name) {
  if (typeof name !== 'string') return false;
  const n = name.trim().length;
  return n >= NAME_MIN && n <= NAME_MAX;
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
