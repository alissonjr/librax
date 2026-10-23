import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { DynamoRepo } from '../src/adapters/dynamoRepo.js';
import {
  createSquad,
  joinSquad,
  leaveSquad,
  manageMember,
  updateSquad,
  regenerateInviteCode,
  transferOwnership,
} from '../src/usecases/squads.js';

// Corridas nas escritas de squad: a squad nunca e regravada inteira depois de lida, entao o
// XP somado por outra licao no meio (ADD) e o memberCount de entradas concorrentes nao se
// perdem. Em memoria e no formato dos comandos do DynamoRepo.

const rng0 = () => 0;

async function squadWithTwo(repo = new InMemoryRepo()) {
  await createSquad(repo, { userId: 'u1', isGuest: false, name: 'Coda de Libras', genId: () => 's1', rng: rng0 });
  await joinSquad(repo, { userId: 'u2', isGuest: false, squadId: 's1' });
  return repo;
}

/** Faz `fn` rodar logo depois da primeira leitura da squad (outra licao no meio). */
function interleaveAfterGetSquad(repo, fn) {
  const getSquad = repo.getSquad.bind(repo);
  let fired = false;
  repo.getSquad = async (...args) => {
    const squad = await getSquad(...args);
    if (!fired) {
      fired = true;
      await fn();
    }
    return squad;
  };
}

test('updateSquad nao perde XP somado por uma licao entre a leitura e a escrita', async () => {
  const repo = await squadWithTwo();
  interleaveAfterGetSquad(repo, () => repo.incrementSquadXp('s1', 'u2', 10));

  const updated = await updateSquad(repo, { userId: 'u1', squadId: 's1', changes: { name: 'Turma B' } });

  const squad = await repo.getSquad('s1');
  assert.equal(squad.name, 'Turma B');
  assert.equal(squad.xpWeekly, 10);
  assert.equal(updated.xpWeekly, 10);
});

test('regenerateInviteCode, leave e kick tambem nao regravam o XP', async () => {
  const repo = await squadWithTwo();
  await joinSquad(repo, { userId: 'u3', isGuest: false, squadId: 's1' });
  await joinSquad(repo, { userId: 'u4', isGuest: false, squadId: 's1' });

  interleaveAfterGetSquad(repo, () => repo.incrementSquadXp('s1', 'u2', 5));
  await regenerateInviteCode(repo, { userId: 'u1', squadId: 's1', rng: () => 0.5 });
  interleaveAfterGetSquad(repo, () => repo.incrementSquadXp('s1', 'u2', 5));
  await leaveSquad(repo, { userId: 'u3', squadId: 's1' });
  // kick nem le a squad: so remove o membro e desconta o memberCount (ADD -1)
  await Promise.all([
    manageMember(repo, { actorId: 'u1', squadId: 's1', targetUserId: 'u4', action: 'kick' }),
    repo.incrementSquadXp('s1', 'u2', 5),
  ]);

  const squad = await repo.getSquad('s1');
  assert.equal(squad.xpWeekly, 15);
  assert.equal(squad.memberCount, 2);
});

test('trocar o papel do membro nao zera a contribuicao somada no meio', async () => {
  const repo = await squadWithTwo();
  const getMember = repo.getMember.bind(repo);
  repo.getMember = async (sid, uid) => {
    const m = await getMember(sid, uid);
    if (uid === 'u2') await repo.incrementSquadXp('s1', 'u2', 7);
    return m;
  };

  await manageMember(repo, { actorId: 'u1', squadId: 's1', targetUserId: 'u2', action: 'promote' });
  await transferOwnership(repo, { userId: 'u1', squadId: 's1', newAdminUserId: 'u2' });

  const member = await getMember('s1', 'u2');
  assert.equal(member.role, 'admin');
  assert.equal(member.xpWeeklyContrib, 14);
});

test('entradas concorrentes somam memberCount e respeitam o limite', async () => {
  const repo = await squadWithTwo();
  await Promise.all(['u3', 'u4', 'u5'].map((userId) => joinSquad(repo, { userId, isGuest: false, squadId: 's1' })));
  assert.equal((await repo.getSquad('s1')).memberCount, 5);

  await updateSquad(repo, { userId: 'u1', squadId: 's1', changes: { maxMembers: 6 } });
  const results = await Promise.allSettled(
    ['u6', 'u7'].map((userId) => joinSquad(repo, { userId, isGuest: false, squadId: 's1' })),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /SQUAD_FULL/);
  assert.equal((await repo.getSquad('s1')).memberCount, 6);
  assert.equal((await repo.listMembers('s1')).length, 6);
});

test('a mesma pessoa entrando duas vezes ao mesmo tempo conta uma vez', async () => {
  const repo = await squadWithTwo();
  const results = await Promise.allSettled([1, 2].map(() => joinSquad(repo, { userId: 'u3', isGuest: false, squadId: 's1' })));
  assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected']);
  assert.equal((await repo.getSquad('s1')).memberCount, 3);
});

// --- formato dos comandos do DynamoRepo ---------------------------------------------------

/**
 * Tabela falsa minima: guarda itens por PK/SK e aplica Get, Put e Update (SET a = :v,
 * SET a = if_not_exists(a, :v), ADD a :v, REMOVE a) na ordem em que chegam. Condicoes sao
 * ignoradas: o teste e sobre o que cada escrita mexe no item.
 */
function fakeTable(items = []) {
  const table = new Map(items.map((i) => [`${i.PK}|${i.SK}`, { ...i }]));
  const calls = [];
  const resolve = (token, names = {}) => names[token] ?? token;
  function applyUpdate(item, input) {
    const names = input.ExpressionAttributeNames ?? {};
    const values = input.ExpressionAttributeValues ?? {};
    const clauses = input.UpdateExpression.split(/\b(?=SET |ADD |REMOVE )/);
    for (const clause of clauses) {
      const [, kind, body] = /^(SET|ADD|REMOVE) (.*)$/s.exec(clause.trim());
      for (const part of body.split(/,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean)) {
        if (kind === 'REMOVE') {
          delete item[resolve(part, names)];
        } else if (kind === 'ADD') {
          const [path, val] = part.split(/\s+/);
          const key = resolve(path, names);
          item[key] = (item[key] ?? 0) + values[val];
        } else {
          const [path, expr] = part.split(/\s*=\s*/);
          const key = resolve(path, names);
          const ine = /^if_not_exists\(([^,]+),\s*(:\w+)\)$/.exec(expr);
          if (ine) item[key] = item[resolve(ine[1], names)] ?? values[ine[2]];
          else item[key] = values[expr];
        }
      }
    }
  }
  return {
    calls,
    table,
    async send(cmd) {
      const name = cmd.constructor.name;
      const { input } = cmd;
      calls.push({ name, input });
      if (name === 'GetCommand') {
        const item = table.get(`${input.Key.PK}|${input.Key.SK}`);
        return { Item: item ? { ...item } : undefined };
      }
      if (name === 'PutCommand') {
        table.set(`${input.Item.PK}|${input.Item.SK}`, { ...input.Item });
        return {};
      }
      if (name === 'UpdateCommand') {
        const key = `${input.Key.PK}|${input.Key.SK}`;
        const item = table.get(key) ?? { ...input.Key };
        applyUpdate(item, input);
        table.set(key, item);
        return input.ReturnValues === 'ALL_NEW' ? { Attributes: { ...item } } : {};
      }
      if (name === 'TransactWriteCommand') {
        for (const t of input.TransactItems) {
          if (t.Update) await this.send({ constructor: { name: 'UpdateCommand' }, input: t.Update });
          if (t.Put) await this.send({ constructor: { name: 'PutCommand' }, input: t.Put });
        }
        return {};
      }
      throw new Error(`comando nao suportado no teste: ${name}`);
    },
  };
}

const meta = {
  PK: 'SQUAD#s1', SK: 'META', squadId: 's1', name: 'Coda', type: 'public', inviteCode: 'ABC234',
  maxMembers: 30, memberCount: 2, xpWeekly: 0, GSI4PK: 'SQUADS_PUBLIC', GSI4SK: 'XP#000000000000#s1',
};
const admin = { PK: 'SQUAD#s1', SK: 'MEMBER#u1', userId: 'u1', role: 'admin', xpWeeklyContrib: 0 };
const member = { PK: 'SQUAD#s1', SK: 'MEMBER#u2', userId: 'u2', role: 'member', xpWeeklyContrib: 0 };

test('DynamoRepo: editar a squad com uma licao no meio mantem o XP (SET so dos campos + ADD)', async () => {
  const db = fakeTable([meta, admin, member]);
  const repo = new DynamoRepo(db);
  interleaveAfterGetSquad(repo, () => repo.incrementSquadXp('s1', 'u2', 10));

  await updateSquad(repo, { userId: 'u1', squadId: 's1', changes: { name: 'Turma B', type: 'private' } });

  const stored = db.table.get('SQUAD#s1|META');
  assert.equal(stored.name, 'Turma B');
  assert.equal(stored.xpWeekly, 10);
  assert.equal(stored.GSI4PK, undefined); // privada sai do diretorio
  const writes = db.calls.filter((c) => c.input.Key?.SK === 'META' || c.input.Item?.SK === 'META');
  assert.equal(writes.some((c) => c.name === 'PutCommand'), false, 'nenhum Put do META depois de criado');
  const edit = writes.find((c) => c.name === 'UpdateCommand' && /#name/.test(c.input.UpdateExpression));
  assert.doesNotMatch(edit.input.UpdateExpression, /xpWeekly|memberCount/);
  assert.equal(edit.input.ConditionExpression, 'attribute_exists(PK)');
});

test('DynamoRepo: duas licoes ao mesmo tempo somam as duas (ADD xpWeekly)', async () => {
  const db = fakeTable([meta, admin, member]);
  const repo = new DynamoRepo(db);
  await Promise.all([repo.incrementSquadXp('s1', 'u1', 10), repo.incrementSquadXp('s1', 'u2', 15)]);

  assert.equal(db.table.get('SQUAD#s1|META').xpWeekly, 25);
  assert.equal(db.table.get('SQUAD#s1|MEMBER#u2').xpWeeklyContrib, 15);
  for (const c of db.calls) assert.match(c.input.UpdateExpression, /ADD /);
});

test('DynamoRepo: entrar reserva a vaga com ADD memberCount condicional ao limite', async () => {
  const db = fakeTable([meta, admin]);
  const repo = new DynamoRepo(db);
  assert.equal(await repo.changeSquadMemberCount('s1', 1), true);
  const { name, input } = db.calls.at(-1);
  assert.equal(name, 'UpdateCommand');
  assert.equal(input.UpdateExpression, 'ADD memberCount :delta');
  assert.equal(input.ConditionExpression, 'attribute_exists(PK) AND memberCount < maxMembers');
  assert.equal(db.table.get('SQUAD#s1|META').memberCount, 3);

  const full = new DynamoRepo({
    async send() {
      const err = new Error('cheia');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    },
  });
  assert.equal(await full.changeSquadMemberCount('s1', 1), false);
});

test('DynamoRepo: membro novo e condicional (nao sobrescreve quem ja esta)', async () => {
  const db = fakeTable();
  assert.equal(await new DynamoRepo(db).putMember('s1', 'u3', { role: 'member' }), true);
  const [memberPut] = db.calls[0].input.TransactItems;
  assert.equal(memberPut.Put.ConditionExpression, 'attribute_not_exists(PK)');

  const dup = new DynamoRepo({
    async send() {
      const err = new Error('cancelada');
      err.name = 'TransactionCanceledException';
      err.CancellationReasons = [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }];
      throw err;
    },
  });
  assert.equal(await dup.putMember('s1', 'u3', { role: 'member' }), false);
});

test('DynamoRepo: trocar o papel so mexe em role (membro e vinculo do usuario)', async () => {
  const db = fakeTable([meta, admin, { ...member, xpWeeklyContrib: 40 }]);
  await new DynamoRepo(db).setMemberRole('s1', 'u2', 'admin');
  const [m, link] = db.calls[0].input.TransactItems.map((t) => t.Update);
  assert.deepEqual(m.Key, { PK: 'SQUAD#s1', SK: 'MEMBER#u2' });
  assert.equal(m.ConditionExpression, 'attribute_exists(PK)');
  assert.deepEqual(link.Key, { PK: 'USER#u2', SK: 'SQUAD#s1' });
  assert.equal(db.table.get('SQUAD#s1|MEMBER#u2').xpWeeklyContrib, 40);
  assert.equal(db.table.get('SQUAD#s1|MEMBER#u2').role, 'admin');
});
