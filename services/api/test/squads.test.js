import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canCreateSquad,
  canJoinSquad,
  leaveOutcome,
  manageMemberOutcome,
  transferOwnershipOutcome,
  validateSquadChanges,
  MAX_SQUADS_PER_USER,
  DESCRIPTION_MAX,
  NAME_MIN,
  NAME_MAX,
} from '../src/domain/squads.js';

// SPEC 04 secoes 0 e 2.

test('limites expostos batem com a spec', () => {
  assert.equal(MAX_SQUADS_PER_USER, 5);
  assert.equal(NAME_MIN, 3);
  assert.equal(NAME_MAX, 40);
});

// --- canCreateSquad ---

test('convidado nao pode criar squad', () => {
  assert.deepEqual(canCreateSquad({ isGuest: true, b2cSquadCount: 0, name: 'Coda' }), {
    ok: false,
    error: 'GUEST_NOT_ALLOWED',
  });
});

test('nao pode criar a 6a squad', () => {
  assert.deepEqual(canCreateSquad({ isGuest: false, b2cSquadCount: 5, name: 'Coda' }), {
    ok: false,
    error: 'SQUADS_LIMIT_REACHED',
  });
});

test('nome curto ou longo demais e invalido', () => {
  assert.equal(canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: 'ab' }).error, 'INVALID_NAME');
  assert.equal(
    canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: 'x'.repeat(41) }).error,
    'INVALID_NAME',
  );
  // trim antes de medir
  assert.equal(canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: '  ab  ' }).error, 'INVALID_NAME');
});

test('tipo so pode ser public ou private (org e criada pelo painel B2B)', () => {
  assert.equal(
    canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: 'Coda', type: 'org' }).error,
    'INVALID_TYPE',
  );
  assert.equal(canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: 'Coda', type: 'x' }).error, 'INVALID_TYPE');
  assert.deepEqual(canCreateSquad({ isGuest: false, b2cSquadCount: 0, name: 'Coda', type: 'private' }), { ok: true });
});

test('criacao valida', () => {
  assert.deepEqual(canCreateSquad({ isGuest: false, b2cSquadCount: 4, name: 'Coda de Libras' }), {
    ok: true,
  });
});

// --- canJoinSquad ---

const fullSquad = { memberCount: 30, maxMembers: 30, type: 'public' };
const openSquad = { memberCount: 12, maxMembers: 30, type: 'public' };

test('convidado nao entra', () => {
  assert.equal(canJoinSquad({ isGuest: true, b2cSquadCount: 0, squad: openSquad }).error, 'GUEST_NOT_ALLOWED');
});

test('ja membro', () => {
  assert.equal(
    canJoinSquad({ isGuest: false, b2cSquadCount: 0, squad: openSquad, alreadyMember: true }).error,
    'ALREADY_MEMBER',
  );
});

test('squad cheia', () => {
  assert.equal(canJoinSquad({ isGuest: false, b2cSquadCount: 0, squad: fullSquad }).error, 'SQUAD_FULL');
});

test('limite de 5 squads B2C bloqueia entrada', () => {
  assert.equal(canJoinSquad({ isGuest: false, b2cSquadCount: 5, squad: openSquad }).error, 'SQUADS_LIMIT_REACHED');
});

test('equipe de org NAO conta no limite de 5', () => {
  const orgTeam = { memberCount: 10, maxMembers: 30, type: 'org' };
  assert.deepEqual(canJoinSquad({ isGuest: false, b2cSquadCount: 5, squad: orgTeam }), { ok: true });
});

test('entrada valida', () => {
  assert.deepEqual(canJoinSquad({ isGuest: false, b2cSquadCount: 1, squad: openSquad }), { ok: true });
});

// --- leaveOutcome ---

test('unico membro: dissolve a squad', () => {
  assert.deepEqual(leaveOutcome({ role: 'admin', isOnlyAdmin: true, memberCount: 1 }), {
    ok: true,
    action: 'dissolve',
  });
});

test('unico admin com outros membros: precisa transferir', () => {
  assert.deepEqual(leaveOutcome({ role: 'admin', isOnlyAdmin: true, memberCount: 8 }), {
    ok: false,
    error: 'MUST_TRANSFER_OWNERSHIP',
  });
});

test('membro comum sai normalmente', () => {
  assert.deepEqual(leaveOutcome({ role: 'member', isOnlyAdmin: false, memberCount: 8 }), {
    ok: true,
    action: 'remove',
  });
});

// --- manageMemberOutcome ---

test('admin nao pode gerenciar a si mesmo por este fluxo', () => {
  assert.equal(
    manageMemberOutcome({ action: 'kick', actorIsTarget: true }).error,
    'CANNOT_MANAGE_SELF',
  );
});

test('nao pode rebaixar o unico admin', () => {
  assert.equal(
    manageMemberOutcome({ action: 'demote', actorIsTarget: false, targetIsOnlyAdmin: true }).error,
    'CANNOT_DEMOTE_ONLY_ADMIN',
  );
});

test('promover e rebaixar validos resolvem o novo papel', () => {
  assert.deepEqual(manageMemberOutcome({ action: 'promote', actorIsTarget: false }), {
    ok: true,
    role: 'admin',
  });
  assert.deepEqual(manageMemberOutcome({ action: 'demote', actorIsTarget: false, targetIsOnlyAdmin: false }), {
    ok: true,
    role: 'member',
  });
  assert.deepEqual(manageMemberOutcome({ action: 'kick', actorIsTarget: false }), {
    ok: true,
    action: 'remove',
  });
});

test('acao desconhecida vira erro de dominio (nao excecao)', () => {
  assert.deepEqual(manageMemberOutcome({ action: 'banir', actorIsTarget: false }), {
    ok: false,
    error: 'INVALID_ACTION',
  });
});

// --- transferOwnershipOutcome ---

test('so admin transfere a administracao', () => {
  assert.equal(
    transferOwnershipOutcome({ actorRole: 'member', actorIsTarget: false, targetIsMember: true }).error,
    'NOT_ADMIN',
  );
  assert.equal(
    transferOwnershipOutcome({ actorRole: null, actorIsTarget: false, targetIsMember: true }).error,
    'NOT_ADMIN',
  );
});

test('nao transfere para si mesmo nem para quem nao e membro', () => {
  assert.equal(
    transferOwnershipOutcome({ actorRole: 'admin', actorIsTarget: true, targetIsMember: true }).error,
    'CANNOT_MANAGE_SELF',
  );
  assert.equal(
    transferOwnershipOutcome({ actorRole: 'admin', actorIsTarget: false, targetIsMember: false }).error,
    'TARGET_NOT_MEMBER',
  );
});

test('transferencia valida promove o alvo e rebaixa quem transferiu', () => {
  assert.deepEqual(transferOwnershipOutcome({ actorRole: 'admin', actorIsTarget: false, targetIsMember: true }), {
    ok: true,
    actorRole: 'member',
    targetRole: 'admin',
  });
});

// --- validateSquadChanges (PATCH /squads/{id}) ---

const squad12 = { squadId: 's1', name: 'Coda', type: 'public', memberCount: 12, maxMembers: 30 };

test('limites de descricao batem com a tela CreateSquad', () => {
  assert.equal(DESCRIPTION_MAX, 200);
});

test('aceita so os campos editaveis e normaliza o nome', () => {
  const r = validateSquadChanges(squad12, {
    name: '  Coda de Libras  ',
    description: 'Turma da noite',
    type: 'private',
    maxMembers: 20,
    memberCount: 1, // nao editavel
    xpWeekly: 9999, // nao editavel
    inviteCode: 'AAAAAA', // nao editavel
  });
  assert.deepEqual(r, {
    ok: true,
    changes: { name: 'Coda de Libras', description: 'Turma da noite', type: 'private', maxMembers: 20 },
  });
});

test('nome invalido, descricao longa e tipo invalido sao recusados', () => {
  assert.equal(validateSquadChanges(squad12, { name: 'ab' }).error, 'INVALID_NAME');
  assert.equal(validateSquadChanges(squad12, { description: 'x'.repeat(201) }).error, 'INVALID_DESCRIPTION');
  assert.equal(validateSquadChanges(squad12, { description: 42 }).error, 'INVALID_DESCRIPTION');
  assert.equal(validateSquadChanges(squad12, { type: 'org' }).error, 'INVALID_TYPE');
});

test('equipe de org nao muda de tipo', () => {
  const org = { ...squad12, type: 'org' };
  assert.equal(validateSquadChanges(org, { type: 'public' }).error, 'INVALID_TYPE');
});

test('maxMembers nunca abaixo do total atual nem acima do padrao de 30', () => {
  assert.equal(validateSquadChanges(squad12, { maxMembers: 11 }).error, 'MAX_MEMBERS_BELOW_COUNT');
  assert.equal(validateSquadChanges(squad12, { maxMembers: 31 }).error, 'INVALID_MAX_MEMBERS');
  assert.equal(validateSquadChanges(squad12, { maxMembers: 12.5 }).error, 'INVALID_MAX_MEMBERS');
  assert.equal(validateSquadChanges(squad12, { maxMembers: '20' }).error, 'INVALID_MAX_MEMBERS');
  assert.deepEqual(validateSquadChanges(squad12, { maxMembers: 12 }), { ok: true, changes: { maxMembers: 12 } });
});

test('sem nenhum campo editavel -> NO_CHANGES', () => {
  assert.equal(validateSquadChanges(squad12, {}).error, 'NO_CHANGES');
  assert.equal(validateSquadChanges(squad12, { memberCount: 99 }).error, 'NO_CHANGES');
  assert.equal(validateSquadChanges(squad12, null).error, 'NO_CHANGES');
});
