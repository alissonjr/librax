import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { createSquad, joinSquad, leaveSquad, manageMember } from '../src/usecases/squads.js';

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
