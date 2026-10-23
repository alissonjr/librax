// Regras puras de squads/equipes (SPEC 04 secoes 0 e 2).
// Guardas de decisao; a persistencia fica nos usecases sobre o repositorio.

export const MAX_SQUADS_PER_USER = 5;
export const DEFAULT_MAX_MEMBERS = 30;
export const NAME_MIN = 3;
export const NAME_MAX = 40;

/** @returns {{ok: true} | {ok: false, error: string}} */
export function canCreateSquad({ isGuest, b2cSquadCount, name }) {
  if (isGuest) return fail('GUEST_NOT_ALLOWED');
  if (b2cSquadCount >= MAX_SQUADS_PER_USER) return fail('SQUADS_LIMIT_REACHED');
  if (!isValidName(name)) return fail('INVALID_NAME');
  return ok();
}

/** @returns {{ok: true} | {ok: false, error: string}} */
export function canJoinSquad({ isGuest, b2cSquadCount, squad, alreadyMember = false }) {
  if (isGuest) return fail('GUEST_NOT_ALLOWED');
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
      throw new Error(`acao de membro desconhecida: ${action}`);
  }
}

function isValidName(name) {
  const n = (name ?? '').trim().length;
  return n >= NAME_MIN && n <= NAME_MAX;
}

const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
