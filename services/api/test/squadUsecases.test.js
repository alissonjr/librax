import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import {
  createSquad,
  joinSquad,
  leaveSquad,
  manageMember,
  transferOwnership,
  updateSquad,
  disbandSquad,
  regenerateInviteCode,
} from '../src/usecases/squads.js';

// SPEC 04 secao 2. genId/rng injetados para determinismo.
const rng0 = () => 0; // sempre o 1o char do alfabeto

async function freshSquad(repo, { userId = 'u1', type = 'public' } = {}) {
  await repo.seedProfile({ userId });
  return createSquad(repo, { userId, isGuest: false, name: 'Coda de Libras', type, genId: () => 's1', rng: rng0 });
}

test('createSquad cria META, torna o criador admin e gera codigo de 6 chars', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  assert.equal(squad.squadId, 's1');
  assert.equal(squad.createdBy, 'u1');
  assert.equal(squad.memberCount, 1);
  assert.equal(squad.inviteCode.length, 6);
  assert.equal((await repo.getMember('s1', 'u1')).role, 'admin');
});

test('createSquad rejeita convidado', async () => {
  const repo = new InMemoryRepo();
  await assert.rejects(
    () => createSquad(repo, { userId: 'g1', isGuest: true, name: 'X Squad', type: 'public', genId: () => 's1', rng: rng0 }),
    /GUEST_NOT_ALLOWED/,
  );
});

test('createSquad rejeita nome invalido', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u1' });
  await assert.rejects(
    () => createSquad(repo, { userId: 'u1', isGuest: false, name: 'ab', type: 'public', genId: () => 's1', rng: rng0 }),
    /INVALID_NAME/,
  );
});

test('joinSquad por codigo adiciona membro e incrementa memberCount', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo, { type: 'private' });
  await repo.seedProfile({ userId: 'u2' });

  const joined = await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });

  assert.equal(joined.squadId, 's1');
  assert.equal((await repo.getSquad('s1')).memberCount, 2);
  assert.equal((await repo.getMember('s1', 'u2')).role, 'member');
});

test('joinSquad com codigo inexistente -> SQUAD_NOT_FOUND', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: 'u2' });
  await assert.rejects(() => joinSquad(repo, { userId: 'u2', isGuest: false, code: 'ZZZZZZ' }), /SQUAD_NOT_FOUND/);
});

test('joinSquad ja membro -> ALREADY_MEMBER', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await assert.rejects(() => joinSquad(repo, { userId: 'u1', isGuest: false, code: squad.inviteCode }), /ALREADY_MEMBER/);
});

test('leaveSquad: unico membro dissolve a squad', async () => {
  const repo = new InMemoryRepo();
  await freshSquad(repo);
  const r = await leaveSquad(repo, { userId: 'u1', squadId: 's1' });
  assert.equal(r.action, 'dissolve');
  assert.equal(await repo.getSquad('s1'), null);
});

test('leaveSquad: unico admin com outros membros -> MUST_TRANSFER_OWNERSHIP', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await repo.seedProfile({ userId: 'u2' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });
  await assert.rejects(() => leaveSquad(repo, { userId: 'u1', squadId: 's1' }), /MUST_TRANSFER_OWNERSHIP/);
});

test('manageMember: admin promove membro a admin', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await repo.seedProfile({ userId: 'u2' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });

  const r = await manageMember(repo, { actorId: 'u1', squadId: 's1', targetUserId: 'u2', action: 'promote' });
  assert.equal(r.role, 'admin');
  assert.equal((await repo.getMember('s1', 'u2')).role, 'admin');
});

test('manageMember: nao-admin e rejeitado', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await repo.seedProfile({ userId: 'u2' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });
  await assert.rejects(
    () => manageMember(repo, { actorId: 'u2', squadId: 's1', targetUserId: 'u1', action: 'kick' }),
    /NOT_ADMIN/,
  );
});

test('manageMember: kick remove o membro e decrementa memberCount', async () => {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await repo.seedProfile({ userId: 'u2' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });

  const r = await manageMember(repo, { actorId: 'u1', squadId: 's1', targetUserId: 'u2', action: 'kick' });
  assert.equal(r.action, 'remove');
  assert.equal(await repo.getMember('s1', 'u2'), null);
  assert.equal((await repo.getSquad('s1')).memberCount, 1);
});

test('createSquad recusa tipo org (equipes B2B vem do painel institucional)', async () => {
  const repo = new InMemoryRepo();
  await assert.rejects(
    () => createSquad(repo, { userId: 'u1', isGuest: false, name: 'Coda', type: 'org', genId: () => 's1', rng: rng0 }),
    /INVALID_TYPE/,
  );
});

/** Squad s1 com u1 admin e u2 membro. */
async function squadWithTwo() {
  const repo = new InMemoryRepo();
  const squad = await freshSquad(repo);
  await repo.seedProfile({ userId: 'u2' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, code: squad.inviteCode });
  return { repo, squad };
}

// --- transferOwnership (POST /squads/{id}/transfer) ---

test('transferOwnership promove o novo admin e rebaixa quem transferiu', async () => {
  const { repo } = await squadWithTwo();
  await repo.incrementSquadXp('s1', 'u2', 40);

  const r = await transferOwnership(repo, { userId: 'u1', squadId: 's1', newAdminUserId: 'u2' });

  assert.equal(r.ok, true);
  assert.equal((await repo.getMember('s1', 'u2')).role, 'admin');
  assert.equal((await repo.getMember('s1', 'u1')).role, 'member');
  assert.equal((await repo.getMember('s1', 'u2')).xpWeeklyContrib, 40); // nao zera a contribuicao
  // depois de transferir, o antigo admin pode sair
  assert.equal((await leaveSquad(repo, { userId: 'u1', squadId: 's1' })).action, 'remove');
});

test('transferOwnership: so admin, alvo precisa ser membro, squad precisa existir', async () => {
  const { repo } = await squadWithTwo();
  await assert.rejects(
    () => transferOwnership(repo, { userId: 'u2', squadId: 's1', newAdminUserId: 'u1' }),
    /NOT_ADMIN/,
  );
  await assert.rejects(
    () => transferOwnership(repo, { userId: 'u1', squadId: 's1', newAdminUserId: 'u9' }),
    /TARGET_NOT_MEMBER/,
  );
  await assert.rejects(
    () => transferOwnership(repo, { userId: 'u1', squadId: 's1', newAdminUserId: 'u1' }),
    /CANNOT_MANAGE_SELF/,
  );
  await assert.rejects(
    () => transferOwnership(repo, { userId: 'u1', squadId: 'nao-existe', newAdminUserId: 'u2' }),
    /SQUAD_NOT_FOUND/,
  );
});

// --- updateSquad (PATCH /squads/{id}) ---

test('updateSquad grava so os campos editaveis e devolve a squad', async () => {
  const { repo, squad } = await squadWithTwo();

  const updated = await updateSquad(repo, {
    userId: 'u1',
    squadId: 's1',
    changes: { name: ' Turma B ', type: 'private', maxMembers: 10, memberCount: 99, inviteCode: 'AAAAAA' },
  });

  assert.equal(updated.name, 'Turma B');
  assert.equal(updated.type, 'private');
  assert.equal(updated.maxMembers, 10);
  assert.equal(updated.memberCount, 2); // ignorado
  assert.equal(updated.inviteCode, squad.inviteCode); // ignorado
  assert.deepEqual(await repo.getSquad('s1'), updated);
});

test('updateSquad: so admin e maxMembers nunca abaixo do total', async () => {
  const { repo } = await squadWithTwo();
  await assert.rejects(
    () => updateSquad(repo, { userId: 'u2', squadId: 's1', changes: { name: 'Outra' } }),
    /NOT_ADMIN/,
  );
  await assert.rejects(
    () => updateSquad(repo, { userId: 'u1', squadId: 's1', changes: { maxMembers: 1 } }),
    /MAX_MEMBERS_BELOW_COUNT/,
  );
  await assert.rejects(
    () => updateSquad(repo, { userId: 'u1', squadId: 'nao-existe', changes: { name: 'Outra' } }),
    /SQUAD_NOT_FOUND/,
  );
});

// --- disbandSquad (DELETE /squads/{id}) ---

test('disbandSquad remove META, membros, vinculos dos usuarios e o convite', async () => {
  const { repo, squad } = await squadWithTwo();

  const r = await disbandSquad(repo, { userId: 'u1', squadId: 's1' });

  assert.equal(r.ok, true);
  assert.equal(await repo.getSquad('s1'), null);
  assert.deepEqual(await repo.listMembers('s1'), []);
  assert.deepEqual(await repo.listUserSquads('u2'), []);
  assert.equal(await repo.findSquadIdByInvite(squad.inviteCode), null);
});

test('disbandSquad: membro comum nao dissolve', async () => {
  const { repo } = await squadWithTwo();
  await assert.rejects(() => disbandSquad(repo, { userId: 'u2', squadId: 's1' }), /NOT_ADMIN/);
  assert.notEqual(await repo.getSquad('s1'), null);
});

// --- regenerateInviteCode (POST /squads/{id}/invite-code/regenerate) ---

test('regenerateInviteCode troca o codigo e o antigo deixa de funcionar', async () => {
  const { repo, squad } = await squadWithTwo();
  const rng = () => 0.99; // ultimo char do alfabeto, diferente do codigo de rng0

  const { inviteCode } = await regenerateInviteCode(repo, { userId: 'u1', squadId: 's1', rng });

  assert.notEqual(inviteCode, squad.inviteCode);
  assert.equal(inviteCode.length, 6);
  assert.equal((await repo.getSquad('s1')).inviteCode, inviteCode);
  assert.equal(await repo.findSquadIdByInvite(inviteCode), 's1');
  assert.equal(await repo.findSquadIdByInvite(squad.inviteCode), null);
  await repo.seedProfile({ userId: 'u3' });
  await assert.rejects(
    () => joinSquad(repo, { userId: 'u3', isGuest: false, code: squad.inviteCode }),
    /SQUAD_NOT_FOUND/,
  );
});

test('regenerateInviteCode: so admin', async () => {
  const { repo } = await squadWithTwo();
  await assert.rejects(
    () => regenerateInviteCode(repo, { userId: 'u2', squadId: 's1', rng: rng0 }),
    /NOT_ADMIN/,
  );
});
