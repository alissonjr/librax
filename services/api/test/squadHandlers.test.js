import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeSquadHandlers } from '../src/handlers/squads.js';
import * as squadHandlers from '../src/handlers/squads.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Rotas de squad (SPEC 04 secao 2) na borda HTTP: auth pelo sub do JWT, erros de dominio
// viram status HTTP com o mesmo codigo da spec. Repo em memoria injetado.

const now = () => new Date('2026-10-23T12:00:00Z');

function event({ sub = 'u1', body, pathParameters } = {}) {
  return {
    requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined },
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters,
  };
}
const parse = (res) => JSON.parse(res.body);

/** Squad s1 criada por u1 (admin), com u2 como membro. */
async function setup({ rng = () => 0 } = {}) {
  const repo = new InMemoryRepo();
  const h = makeSquadHandlers({ repo, now, genId: () => 's1', rng });
  const created = parse(await h.createSquadHandler(event({ body: { name: 'Coda de Libras', type: 'private' } })));
  await h.joinSquadHandler(event({ sub: 'u2', body: { inviteCode: created.inviteCode.toLowerCase() } }));
  return { repo, h, created };
}

test('todas as rotas de squad exportam handler de producao (nada de import indefinido)', () => {
  for (const name of [
    'createSquadHandler',
    'joinSquadHandler',
    'leaveSquadHandler',
    'transferOwnershipHandler',
    'updateSquadHandler',
    'disbandSquadHandler',
    'manageMemberHandler',
    'regenerateInviteCodeHandler',
    'getSquadHandler',
    'listMySquadsHandler',
  ]) {
    assert.equal(typeof squadHandlers[name], 'function', name);
  }
});

// --- POST /v1/squads/{squadId}/transfer ---

test('transfer: admin passa a administracao para outro membro', async () => {
  const { repo, h } = await setup();
  const res = await h.transferOwnershipHandler(
    event({ body: { newAdminUserId: 'u2' }, pathParameters: { squadId: 's1' } }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.getMember('s1', 'u2')).role, 'admin');
  assert.equal((await repo.getMember('s1', 'u1')).role, 'member');
});

test('transfer: membro comum recebe 403 e alvo fora da squad 404', async () => {
  const { h } = await setup();
  const notAdmin = await h.transferOwnershipHandler(
    event({ sub: 'u2', body: { newAdminUserId: 'u1' }, pathParameters: { squadId: 's1' } }),
  );
  assert.equal(notAdmin.statusCode, 403);
  assert.equal(parse(notAdmin).error.code, 'NOT_ADMIN');

  const outsider = await h.transferOwnershipHandler(
    event({ body: { newAdminUserId: 'u9' }, pathParameters: { squadId: 's1' } }),
  );
  assert.equal(outsider.statusCode, 404);
  assert.equal(parse(outsider).error.code, 'TARGET_NOT_MEMBER');

  const missing = await h.transferOwnershipHandler(event({ body: {}, pathParameters: { squadId: 's1' } }));
  assert.equal(missing.statusCode, 400);
});

// --- PATCH /v1/squads/{squadId} ---

test('update: admin edita nome, visibilidade e limite', async () => {
  const { h } = await setup();
  const res = await h.updateSquadHandler(
    event({ body: { name: 'Turma B', type: 'public', maxMembers: 10 }, pathParameters: { squadId: 's1' } }),
  );
  assert.equal(res.statusCode, 200);
  const squad = parse(res);
  assert.equal(squad.name, 'Turma B');
  assert.equal(squad.type, 'public');
  assert.equal(squad.maxMembers, 10);
});

test('update: limite abaixo do total e 409; nome invalido e 400; membro comum e 403', async () => {
  const { h } = await setup();
  const below = await h.updateSquadHandler(event({ body: { maxMembers: 1 }, pathParameters: { squadId: 's1' } }));
  assert.equal(below.statusCode, 409);
  assert.equal(parse(below).error.code, 'MAX_MEMBERS_BELOW_COUNT');

  const badName = await h.updateSquadHandler(event({ body: { name: 'ab' }, pathParameters: { squadId: 's1' } }));
  assert.equal(badName.statusCode, 400);
  assert.equal(parse(badName).error.code, 'INVALID_NAME');

  const member = await h.updateSquadHandler(
    event({ sub: 'u2', body: { name: 'Outra' }, pathParameters: { squadId: 's1' } }),
  );
  assert.equal(member.statusCode, 403);
});

// --- DELETE /v1/squads/{squadId} ---

test('disband: admin dissolve; depois a squad responde 404', async () => {
  const { h } = await setup();
  const res = await h.disbandSquadHandler(event({ pathParameters: { squadId: 's1' } }));
  assert.equal(res.statusCode, 200);
  const after = await h.getSquadHandler(event({ pathParameters: { squadId: 's1' } }));
  assert.equal(after.statusCode, 404);
});

test('disband: membro comum recebe 403 e squad inexistente 404', async () => {
  const { h } = await setup();
  assert.equal((await h.disbandSquadHandler(event({ sub: 'u2', pathParameters: { squadId: 's1' } }))).statusCode, 403);
  const missing = await h.disbandSquadHandler(event({ pathParameters: { squadId: 'nao-existe' } }));
  assert.equal(missing.statusCode, 404);
  assert.equal(parse(missing).error.code, 'SQUAD_NOT_FOUND');
});

// --- POST /v1/squads/{squadId}/invite-code/regenerate ---

test('regenerate: devolve o codigo novo e o antigo para de funcionar', async () => {
  let n = 0;
  const { h, created } = await setup({ rng: () => (n++ < 6 ? 0 : 0.99) }); // 1o codigo AAAAAA, depois 999999
  const res = await h.regenerateInviteCodeHandler(event({ pathParameters: { squadId: 's1' } }));
  assert.equal(res.statusCode, 200);
  const { inviteCode } = parse(res);
  assert.notEqual(inviteCode, created.inviteCode);

  const old = await h.joinSquadHandler(event({ sub: 'u3', body: { inviteCode: created.inviteCode } }));
  assert.equal(old.statusCode, 404);
  const fresh = await h.joinSquadHandler(event({ sub: 'u3', body: { inviteCode } }));
  assert.equal(fresh.statusCode, 200);
});

test('regenerate: membro comum recebe 403', async () => {
  const { h } = await setup();
  const res = await h.regenerateInviteCodeHandler(event({ sub: 'u2', pathParameters: { squadId: 's1' } }));
  assert.equal(res.statusCode, 403);
});

// --- erros das rotas que ja existiam (codigos da spec 4.4) ---

test('create: nome invalido e 400 e tipo org e recusado', async () => {
  const h = makeSquadHandlers({ repo: new InMemoryRepo(), now, genId: () => 's1', rng: () => 0 });
  const bad = await h.createSquadHandler(event({ body: { name: 'ab' } }));
  assert.equal(bad.statusCode, 400);
  assert.equal(parse(bad).error.code, 'INVALID_NAME');
  const org = await h.createSquadHandler(event({ body: { name: 'Coda', type: 'org' } }));
  assert.equal(org.statusCode, 400);
  assert.equal(parse(org).error.code, 'INVALID_TYPE');
});

test('join: codigos de erro da tela JoinByCode (SQUAD_NOT_FOUND, ALREADY_MEMBER)', async () => {
  const { h, created } = await setup();
  const notFound = await h.joinSquadHandler(event({ sub: 'u3', body: { inviteCode: 'ZZZZZZ' } }));
  assert.equal(notFound.statusCode, 404);
  assert.equal(parse(notFound).error.code, 'SQUAD_NOT_FOUND');
  const again = await h.joinSquadHandler(event({ sub: 'u2', body: { inviteCode: created.inviteCode } }));
  assert.equal(again.statusCode, 409);
  assert.equal(parse(again).error.code, 'ALREADY_MEMBER');
});

test('manage: o admin autenticado age sobre o membro da URL', async () => {
  const { repo, h } = await setup();
  const res = await h.manageMemberHandler(
    event({ body: { action: 'promote' }, pathParameters: { squadId: 's1', userId: 'u2' } }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal((await repo.getMember('s1', 'u2')).role, 'admin');

  const self = await h.manageMemberHandler(
    event({ body: { action: 'kick' }, pathParameters: { squadId: 's1', userId: 'u1' } }),
  );
  assert.equal(self.statusCode, 400);
  assert.equal(parse(self).error.code, 'CANNOT_MANAGE_SELF');

  const bad = await h.manageMemberHandler(
    event({ body: { action: 'banir' }, pathParameters: { squadId: 's1', userId: 'u2' } }),
  );
  assert.equal(bad.statusCode, 400);
  assert.equal(parse(bad).error.code, 'INVALID_ACTION');
});

test('leave: unico admin com outros membros recebe 409 MUST_TRANSFER_OWNERSHIP', async () => {
  const { h } = await setup();
  const res = await h.leaveSquadHandler(event({ pathParameters: { squadId: 's1' } }));
  assert.equal(res.statusCode, 409);
  assert.equal(parse(res).error.code, 'MUST_TRANSFER_OWNERSHIP');
});

test('erro de infraestrutura continua 500 sem vazar a mensagem interna', async () => {
  const repo = new InMemoryRepo();
  repo.getSquad = async () => {
    throw new Error('ProvisionedThroughputExceededException: detalhe interno');
  };
  const h = makeSquadHandlers({ repo, now, genId: () => 's1', rng: () => 0 });
  const res = await h.disbandSquadHandler(event({ pathParameters: { squadId: 's1' } }));
  assert.equal(res.statusCode, 500);
  assert.equal(parse(res).error.code, 'INTERNAL_ERROR');
});
