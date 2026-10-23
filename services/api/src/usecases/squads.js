import {
  canCreateSquad,
  canJoinSquad,
  leaveOutcome,
  manageMemberOutcome,
  transferOwnershipOutcome,
  validateSquadChanges,
  DEFAULT_MAX_MEMBERS,
} from '../domain/squads.js';
import { generateInviteCode, normalizeInviteCode } from '../domain/invite.js';

// Usecases de squad (SPEC 04 secao 2). Cada um carrega o contexto do repositorio,
// aplica a guarda pura do dominio e persiste. Falha de guarda vira Error(codigo).
//
// Depois de criada, a squad nunca e regravada inteira a partir do que foi lido: edicoes usam
// updateSquadFields (SET so dos campos), o memberCount usa changeSquadMemberCount (ADD
// condicional ao limite) e papel de membro usa setMemberRole. Assim o XP somado por uma
// licao no meio (ADD em incrementSquadXp) e entradas concorrentes nao se perdem.

class SquadError extends Error {}
const fail = (code) => {
  throw new SquadError(code);
};

/**
 * POST /squads (SPEC 04 secao 2 - createSquad).
 * @param {object} input { userId, isGuest, name, description?, type, genId, rng, now? }
 */
export async function createSquad(repo, input) {
  const { userId, isGuest, name, description = '', type = 'public', genId, rng, now = null } = input;

  const b2cSquadCount = await repo.countUserB2cSquads(userId);
  const check = canCreateSquad({ isGuest, b2cSquadCount, name, type });
  if (!check.ok) fail(check.error);

  const inviteCode = await uniqueInviteCode(repo, rng);
  const squad = {
    squadId: genId(),
    name: name.trim(),
    description,
    type,
    createdBy: userId,
    inviteCode,
    maxMembers: DEFAULT_MAX_MEMBERS,
    memberCount: 1,
    xpWeekly: 0,
    xpAllTime: 0,
    createdAt: now,
  };

  await repo.putSquad(squad);
  await repo.putMember(squad.squadId, userId, { role: 'admin', joinedAt: now });
  await repo.indexInvite(inviteCode, squad.squadId);
  return squad;
}

/**
 * POST /squads/join (SPEC 04 secao 2 - joinSquad).
 * @param {object} input { userId, isGuest, code? , squadId?, now? }
 */
export async function joinSquad(repo, input) {
  const { userId, isGuest } = input;

  const squadId = input.code
    ? await repo.findSquadIdByInvite(normalizeInviteCode(input.code))
    : input.squadId;
  if (!squadId) fail('SQUAD_NOT_FOUND');

  const squad = await repo.getSquad(squadId);
  if (!squad) fail('SQUAD_NOT_FOUND');

  const alreadyMember = (await repo.getMember(squadId, userId)) !== null;
  const b2cSquadCount = await repo.countUserB2cSquads(userId);
  const check = canJoinSquad({ isGuest, b2cSquadCount, squad, alreadyMember, viaInvite: Boolean(input.code) });
  if (!check.ok) fail(check.error);

  // reserva a vaga antes (ADD condicional ao limite) e devolve se a pessoa ja tinha entrado
  if (!(await repo.changeSquadMemberCount(squadId, 1))) fail('SQUAD_FULL');
  if (!(await repo.putMember(squadId, userId, { role: 'member', joinedAt: input.now ?? null }))) {
    await repo.changeSquadMemberCount(squadId, -1);
    fail('ALREADY_MEMBER');
  }
  return repo.getSquad(squadId);
}

/**
 * POST /squads/{id}/leave (SPEC 04 secao 2 - leaveSquad).
 * @param {object} input { userId, squadId }
 */
export async function leaveSquad(repo, input) {
  const { userId, squadId } = input;
  const member = await repo.getMember(squadId, userId);
  if (!member) fail('NOT_MEMBER');

  const squad = await repo.getSquad(squadId);
  const isOnlyAdmin = member.role === 'admin' && (await repo.countAdmins(squadId)) === 1;
  const outcome = leaveOutcome({ isOnlyAdmin, memberCount: squad.memberCount });
  if (!outcome.ok) fail(outcome.error);

  if (outcome.action === 'dissolve') {
    await repo.deleteSquad(squadId);
  } else {
    await repo.removeMember(squadId, userId);
    await repo.changeSquadMemberCount(squadId, -1);
  }
  return outcome;
}

/**
 * POST /squads/{id}/members/{userId}/manage (SPEC 04 secao 2 - manageMember).
 * @param {object} input { actorId, squadId, targetUserId, action }
 */
export async function manageMember(repo, input) {
  const { actorId, squadId, targetUserId, action } = input;

  const actor = await repo.getMember(squadId, actorId);
  if (!actor || actor.role !== 'admin') fail('NOT_ADMIN');

  const target = await repo.getMember(squadId, targetUserId);
  if (!target) fail('TARGET_NOT_MEMBER');

  const targetIsOnlyAdmin = target.role === 'admin' && (await repo.countAdmins(squadId)) === 1;
  const outcome = manageMemberOutcome({ action, actorIsTarget: actorId === targetUserId, targetIsOnlyAdmin });
  if (!outcome.ok) fail(outcome.error);

  if (outcome.action === 'remove') {
    await repo.removeMember(squadId, targetUserId);
    await repo.changeSquadMemberCount(squadId, -1);
  } else {
    await repo.setMemberRole(squadId, targetUserId, outcome.role);
  }
  return outcome;
}

/**
 * POST /squads/{id}/transfer (SPEC 04 secao 2 - transferOwnership).
 * @param {object} input { userId, squadId, newAdminUserId }
 */
export async function transferOwnership(repo, input) {
  const { userId, squadId, newAdminUserId } = input;
  await requireSquad(repo, squadId);

  const actor = await repo.getMember(squadId, userId);
  const target = await repo.getMember(squadId, newAdminUserId);
  const outcome = transferOwnershipOutcome({
    actorRole: actor?.role ?? null,
    actorIsTarget: userId === newAdminUserId,
    targetIsMember: target !== null,
  });
  if (!outcome.ok) fail(outcome.error);

  // promove antes de rebaixar: a squad nunca fica sem admin, mesmo se a 2a escrita falhar
  await repo.setMemberRole(squadId, newAdminUserId, outcome.targetRole);
  await repo.setMemberRole(squadId, userId, outcome.actorRole);
  return outcome;
}

/**
 * PATCH /squads/{id} (SPEC 04 secao 2 - updateSquad). A troca de visibilidade ajusta o
 * GSI4 no adaptador (putSquad so indexa squad publica).
 * @param {object} input { userId, squadId, changes }
 */
export async function updateSquad(repo, input) {
  const { userId, squadId } = input;
  const squad = await requireSquad(repo, squadId);
  await requireAdmin(repo, squadId, userId);

  const check = validateSquadChanges(squad, input.changes);
  if (!check.ok) fail(check.error);

  return repo.updateSquadFields(squadId, check.changes);
}

/**
 * DELETE /squads/{id} (SPEC 04 secao 2 - disbandSquad): remove META, membros, vinculos
 * dos usuarios e o convite.
 * @param {object} input { userId, squadId }
 */
export async function disbandSquad(repo, input) {
  const { userId, squadId } = input;
  await requireSquad(repo, squadId);
  await requireAdmin(repo, squadId, userId);
  await repo.deleteSquad(squadId);
  return { ok: true, action: 'dissolve' };
}

/**
 * POST /squads/{id}/invite-code/regenerate (SPEC 04 secao 2 - regenerateInviteCode).
 * Indexa o codigo novo antes de apagar o antigo: nunca ha janela sem codigo valido.
 * @param {object} input { userId, squadId, rng }
 * @returns {Promise<{inviteCode: string}>}
 */
export async function regenerateInviteCode(repo, input) {
  const { userId, squadId, rng } = input;
  const squad = await requireSquad(repo, squadId);
  await requireAdmin(repo, squadId, userId);

  const inviteCode = await uniqueInviteCode(repo, rng);
  await repo.indexInvite(inviteCode, squadId);
  await repo.updateSquadFields(squadId, { inviteCode });
  if (squad.inviteCode) await repo.removeInvite(squad.inviteCode);
  return { inviteCode };
}

async function requireSquad(repo, squadId) {
  const squad = await repo.getSquad(squadId);
  if (!squad) fail('SQUAD_NOT_FOUND');
  return squad;
}

async function requireAdmin(repo, squadId, userId) {
  const member = await repo.getMember(squadId, userId);
  if (member?.role !== 'admin') fail('NOT_ADMIN');
  return member;
}

async function uniqueInviteCode(repo, rng, attempts = 10) {
  for (let i = 0; i < attempts; i++) {
    const code = generateInviteCode(rng);
    if ((await repo.findSquadIdByInvite(code)) === null) return code;
  }
  throw new SquadError('INVITE_CODE_EXHAUSTED');
}

export { SquadError };
