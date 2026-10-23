import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DynamoRepo } from '../src/adapters/dynamoRepo.js';

// Formato dos itens novos na tabela single-table, sem AWS: um client falso guarda os
// comandos enviados e devolve respostas prontas.

function fakeClient(responder = () => ({})) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      return responder(cmd.constructor.name, cmd.input);
    },
  };
}

test('claimLessonAttempt grava ATTEMPT# com escrita condicional', async () => {
  const db = fakeClient();
  const repo = new DynamoRepo(db);

  assert.equal(await repo.claimLessonAttempt('u1', 'attempt-0001', { lessonId: 'u1-l1' }), true);

  const [{ name, input }] = db.calls;
  assert.equal(name, 'PutCommand');
  assert.equal(input.Item.PK, 'USER#u1');
  assert.equal(input.Item.SK, 'ATTEMPT#attempt-0001');
  assert.equal(input.Item.status, 'pending');
  assert.equal(typeof input.Item.expiresAt, 'number'); // TTL da tabela
  assert.equal(input.ConditionExpression, 'attribute_not_exists(PK)');
});

test('claimLessonAttempt devolve false quando a tentativa ja existe', async () => {
  const db = fakeClient(() => {
    const err = new Error('existe');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  });
  assert.equal(await new DynamoRepo(db).claimLessonAttempt('u1', 'attempt-0001', {}), false);
});

test('putPushSubscription grava USER#<id> / PUSH#<hash>', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).putPushSubscription('u1', 'abc123', { endpoint: 'https://x', keys: { p256dh: 'p', auth: 'a' } });
  const { input } = db.calls[0];
  assert.equal(input.Item.PK, 'USER#u1');
  assert.equal(input.Item.SK, 'PUSH#abc123');
  assert.equal(input.Item.endpoint, 'https://x');
});

test('listPushSubscriptions devolve subscriptionId sem as chaves da tabela', async () => {
  const db = fakeClient(() => ({
    Items: [{ PK: 'USER#u1', SK: 'PUSH#abc123', endpoint: 'https://x', keys: { p256dh: 'p', auth: 'a' } }],
  }));
  const subs = await new DynamoRepo(db).listPushSubscriptions('u1');
  assert.deepEqual(subs, [{ subscriptionId: 'abc123', endpoint: 'https://x', keys: { p256dh: 'p', auth: 'a' } }]);
});

test('saveNotifState indexa no GSI6 pelo balde de fuso so com lembrete ligado', async () => {
  const db = fakeClient();
  const repo = new DynamoRepo(db);
  const now = new Date('2026-10-23T12:00:00Z');

  await repo.saveNotifState('u1', { reminderHour: 19, timezone: 'America/Sao_Paulo' }, now);
  await repo.saveNotifState('u2', { reminderHour: null, timezone: 'America/Sao_Paulo' }, now);

  const [on, off] = db.calls.map((c) => c.input.Item);
  assert.equal(on.SK, 'NOTIF');
  assert.equal(on.GSI6PK, 'NOTIF#H-3');
  assert.equal(on.GSI6SK, 'USER#u1');
  assert.equal(off.GSI6PK, undefined);
});

test('listNotifCandidates consulta o GSI6 com paginacao', async () => {
  let page = 0;
  const db = fakeClient(() => {
    page += 1;
    return page === 1
      ? { Items: [{ PK: 'USER#u1', SK: 'NOTIF', GSI6PK: 'NOTIF#H-3', userId: 'u1' }], LastEvaluatedKey: { k: 1 } }
      : { Items: [{ PK: 'USER#u2', SK: 'NOTIF', GSI6PK: 'NOTIF#H-3', userId: 'u2' }] };
  });
  const out = await new DynamoRepo(db).listNotifCandidates(-3);
  assert.deepEqual(out.map((n) => n.userId), ['u1', 'u2']);
  assert.equal(db.calls[0].input.IndexName, 'GSI6');
  assert.equal(db.calls[1].input.ExclusiveStartKey.k, 1);
});

test('removeInvite apaga o item INVITE#<codigo> (codigo regenerado deixa de funcionar)', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).removeInvite('abc234');
  const [{ name, input }] = db.calls;
  assert.equal(name, 'DeleteCommand');
  assert.deepEqual(input.Key, { PK: 'INVITE#ABC234', SK: 'META' });
});

test('deleteSquad apaga META, membros, vinculos USER#/SQUAD# e o convite numa transacao', async () => {
  const db = fakeClient((name) => {
    if (name === 'GetCommand') return { Item: { PK: 'SQUAD#s1', SK: 'META', squadId: 's1', inviteCode: 'ABC234' } };
    if (name === 'QueryCommand') return { Items: [{ PK: 'SQUAD#s1', SK: 'MEMBER#u1', userId: 'u1' }] };
    return {};
  });
  await new DynamoRepo(db).deleteSquad('s1');
  const tx = db.calls.find((c) => c.name === 'TransactWriteCommand');
  const keys = tx.input.TransactItems.map((i) => `${i.Delete.Key.PK}|${i.Delete.Key.SK}`);
  assert.deepEqual(keys.sort(), ['INVITE#ABC234|META', 'SQUAD#s1|MEMBER#u1', 'SQUAD#s1|META', 'USER#u1|SQUAD#s1']);
});
