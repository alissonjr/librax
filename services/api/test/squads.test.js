import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canCreateSquad,
  canJoinSquad,
  leaveOutcome,
  manageMemberOutcome,
  MAX_SQUADS_PER_USER,
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
