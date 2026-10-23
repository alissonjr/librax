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

// --- ligas: fechamento semanal (GSI2 sobrecarregado: USER#<id> e LEAGUES#<semana>) ---

const ouroW44 = { leagueId: 'ouro-2026-w44', tier: 'ouro', period: '2026-w44', periodStart: '2026-10-26' };

test('joinLeague grava membro (GSI2 USER#) e META da liga (GSI2 LEAGUES#) sem zerar XP', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).joinLeague(ouroW44, 'u1');

  const [{ name, input }] = db.calls;
  assert.equal(name, 'TransactWriteCommand');
  const [member, meta] = input.TransactItems.map((i) => i.Update);
  assert.deepEqual(member.Key, { PK: 'LEAGUE#ouro-2026-w44', SK: 'USER#u1' });
  assert.match(member.UpdateExpression, /xpPeriod = if_not_exists\(xpPeriod, :zero\)/);
  assert.equal(member.ExpressionAttributeValues[':g2pk'], 'USER#u1');
  assert.equal(member.ExpressionAttributeValues[':g2sk'], 'LEAGUE#2026-w44');
  assert.deepEqual(meta.Key, { PK: 'LEAGUE#ouro-2026-w44', SK: 'META' });
  assert.match(meta.UpdateExpression, /#status = if_not_exists\(#status, :open\)/);
  assert.equal(meta.ExpressionAttributeValues[':g2pk'], 'LEAGUES#2026-w44');
  assert.equal(meta.ExpressionAttributeValues[':g2sk'], 'LEAGUE#ouro-2026-w44');
});

test('listLeaguesOfPeriod pagina pelo GSI2 e devolve o cursor', async () => {
  const db = fakeClient(() => ({
    Items: [{ PK: 'LEAGUE#ouro-2026-w43', SK: 'META', GSI2PK: 'LEAGUES#2026-w43', leagueId: 'ouro-2026-w43', tier: 'ouro' }],
    LastEvaluatedKey: { PK: 'LEAGUE#ouro-2026-w43' },
  }));
  const page = await new DynamoRepo(db).listLeaguesOfPeriod('2026-w43', { limit: 25, cursor: { PK: 'x' } });

  const { input } = db.calls[0];
  assert.equal(input.IndexName, 'GSI2');
  assert.equal(input.ExpressionAttributeValues[':pk'], 'LEAGUES#2026-w43');
  assert.equal(input.Limit, 25);
  assert.deepEqual(input.ExclusiveStartKey, { PK: 'x' });
  assert.deepEqual(page.leagues, [{ leagueId: 'ouro-2026-w43', tier: 'ouro' }]);
  assert.deepEqual(page.cursor, { PK: 'LEAGUE#ouro-2026-w43' });
});

test('listLeagueMembers le todas as paginas da liga, sem o META', async () => {
  let page = 0;
  const db = fakeClient(() => {
    page += 1;
    return page === 1
      ? { Items: [{ PK: 'LEAGUE#l', SK: 'USER#u1', userId: 'u1', xpPeriod: 40 }], LastEvaluatedKey: { k: 1 } }
      : { Items: [{ PK: 'LEAGUE#l', SK: 'USER#u2', xpPeriod: 0 }] };
  });
  const members = await new DynamoRepo(db).listLeagueMembers('l');
  assert.deepEqual(members, [{ userId: 'u1', xpPeriod: 40 }, { userId: 'u2', xpPeriod: 0 }]);
  assert.equal(db.calls[0].input.ExpressionAttributeValues[':prefix'], 'USER#');
  assert.deepEqual(db.calls[1].input.ExclusiveStartKey, { k: 1 });
});

test('applyLeagueResult grava USER#<id> / LEAGUE so uma vez por semana', async () => {
  const db = fakeClient();
  const result = { userId: 'u1', toTier: 'safira', outcome: 'promoted', period: '2026-w43' };
  const r = await new DynamoRepo(db).applyLeagueResult('u1', result);

  assert.deepEqual(r, { applied: true, result });
  const { input } = db.calls[0];
  assert.deepEqual([input.Item.PK, input.Item.SK, input.Item.tier], ['USER#u1', 'LEAGUE', 'safira']);
  assert.equal(input.ConditionExpression, 'attribute_not_exists(lastClosedPeriod) OR lastClosedPeriod < :period');
  assert.equal(input.ExpressionAttributeValues[':period'], '2026-w43');
});

test('applyLeagueResult repetido devolve o resultado ja gravado', async () => {
  const stored = { userId: 'u1', toTier: 'safira', outcome: 'promoted', period: '2026-w43' };
  const db = fakeClient((name) => {
    if (name === 'PutCommand') {
      const err = new Error('ja aplicado');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }
    return { Item: { PK: 'USER#u1', SK: 'LEAGUE', tier: 'safira', lastResult: stored, lastClosedPeriod: '2026-w43' } };
  });
  const r = await new DynamoRepo(db).applyLeagueResult('u1', { ...stored, toTier: 'rubi' });
  assert.deepEqual(r, { applied: false, result: stored });
  assert.equal(db.calls[1].input.ConsistentRead, true);
});

test('getUserLeague pega a liga mais recente do usuario (semana atual)', async () => {
  const db = fakeClient(() => ({ Items: [{ leagueId: 'safira-2026-w44', period: '2026-w44' }] }));
  const league = await new DynamoRepo(db).getUserLeague('u1');
  assert.deepEqual(league, { leagueId: 'safira-2026-w44', period: '2026-w44' });
  const { input } = db.calls[0];
  assert.equal(input.ScanIndexForward, false);
  assert.equal(input.ExpressionAttributeValues[':prefix'], 'LEAGUE#');
});

test('markLeagueClosed marca o META como fechado', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).markLeagueClosed('ouro-2026-w43', { closedAt: '2026-10-26T00:05:00.000Z', promoted: 3 });
  const { name, input } = db.calls[0];
  assert.equal(name, 'UpdateCommand');
  assert.deepEqual(input.Key, { PK: 'LEAGUE#ouro-2026-w43', SK: 'META' });
  assert.equal(input.ExpressionAttributeValues[':closed'], 'closed');
  assert.equal(input.ConditionExpression, 'attribute_exists(PK)');
});

// --- ligas: entrada com grupos de ate 30 (contador condicional) ---

function canceled(codes) {
  const err = new Error('cancelada');
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = codes.map((Code) => ({ Code }));
  return err;
}

const conditionFailed = () => {
  const err = new Error('condicao');
  err.name = 'ConditionalCheckFailedException';
  return err;
};

test('joinLeague com maxMembers: contador condicional no META e uma vaga por pessoa e semana', async () => {
  const db = fakeClient();
  const r = await new DynamoRepo(db).joinLeague(ouroW44, 'u1', { maxMembers: 30, displayName: 'Ana' });

  assert.deepEqual(r, { status: 'joined', leagueId: 'ouro-2026-w44' });
  const [{ name, input }] = db.calls;
  assert.equal(name, 'TransactWriteCommand');
  const [member, meta, placement] = input.TransactItems;
  assert.match(member.Update.UpdateExpression, /displayName = :dn/);
  assert.match(meta.Update.UpdateExpression, /ADD memberCount :one/);
  assert.equal(meta.Update.ConditionExpression, 'attribute_not_exists(memberCount) OR memberCount < :max');
  assert.equal(meta.Update.ExpressionAttributeValues[':max'], 30);
  assert.deepEqual(placement.Put.Item, {
    PK: 'USER#u1', SK: 'LEAGUEWEEK#2026-w44', leagueId: 'ouro-2026-w44', tier: 'ouro', period: '2026-w44',
  });
  assert.equal(placement.Put.ConditionExpression, 'attribute_not_exists(PK)');
});

test('joinLeague: META cheio devolve full; pessoa ja colocada devolve a liga dela', async () => {
  const full = fakeClient(() => {
    throw canceled(['None', 'ConditionalCheckFailed', 'None']);
  });
  assert.deepEqual(await new DynamoRepo(full).joinLeague(ouroW44, 'u1', { maxMembers: 30 }), {
    status: 'full', leagueId: 'ouro-2026-w44',
  });

  const placed = fakeClient((name) => {
    if (name === 'TransactWriteCommand') throw canceled(['None', 'None', 'ConditionalCheckFailed']);
    return { Item: { PK: 'USER#u1', SK: 'LEAGUEWEEK#2026-w44', leagueId: 'ouro-2026-w44-g2', tier: 'ouro', period: '2026-w44' } };
  });
  assert.deepEqual(await new DynamoRepo(placed).joinLeague(ouroW44, 'u1', { maxMembers: 30 }), {
    status: 'already', leagueId: 'ouro-2026-w44-g2',
  });
  assert.equal(placed.calls[1].input.ConsistentRead, true);
});

test('getLeaguePlacement le USER#<id> / LEAGUEWEEK#<semana> com leitura consistente', async () => {
  const db = fakeClient(() => ({ Item: { PK: 'USER#u1', SK: 'LEAGUEWEEK#2026-w44', leagueId: 'ouro-2026-w44', tier: 'ouro', period: '2026-w44' } }));
  const p = await new DynamoRepo(db).getLeaguePlacement('u1', '2026-w44');
  assert.deepEqual(p, { leagueId: 'ouro-2026-w44', tier: 'ouro', period: '2026-w44' });
  assert.deepEqual(db.calls[0].input.Key, { PK: 'USER#u1', SK: 'LEAGUEWEEK#2026-w44' });
  assert.equal(db.calls[0].input.ConsistentRead, true);
});

test('advanceLeagueGroup so avanca o cursor de quem viu o grupo cheio', async () => {
  const db = fakeClient();
  assert.equal(await new DynamoRepo(db).advanceLeagueGroup('ouro', '2026-w44', 1), 2);
  const { input } = db.calls[0];
  assert.deepEqual(input.Key, { PK: 'LEAGUEGROUPS#ouro#2026-w44', SK: 'META' });
  assert.equal(input.ConditionExpression, 'attribute_not_exists(#group) OR #group = :cur');
  assert.equal(input.ExpressionAttributeValues[':next'], 2);

  // outra escrita ja avancou: devolve o cursor atual
  const raced = fakeClient((name) => {
    if (name === 'UpdateCommand') throw conditionFailed();
    return { Item: { group: 3 } };
  });
  assert.equal(await new DynamoRepo(raced).advanceLeagueGroup('ouro', '2026-w44', 2), 3);
  assert.equal(raced.calls[0].input.ConditionExpression, '#group = :cur');
});

test('markLeagueResultSeen guarda a semana vista so para frente', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).markLeagueResultSeen('u1', '2026-w43');
  const { name, input } = db.calls[0];
  assert.equal(name, 'UpdateCommand');
  assert.deepEqual(input.Key, { PK: 'USER#u1', SK: 'LEAGUE_SEEN' });
  assert.equal(input.ConditionExpression, 'attribute_not_exists(#period) OR #period < :p');
  assert.equal(input.ExpressionAttributeValues[':p'], '2026-w43');

  // semana mais antiga que a ja vista: a condicao falha e nada muda
  const older = fakeClient(() => {
    throw conditionFailed();
  });
  await new DynamoRepo(older).markLeagueResultSeen('u1', '2026-w40');
});

test('getLeagueResultSeen devolve a semana vista ou null', async () => {
  const db = fakeClient(() => ({ Item: { PK: 'USER#u1', SK: 'LEAGUE_SEEN', period: '2026-w43' } }));
  assert.equal(await new DynamoRepo(db).getLeagueResultSeen('u1'), '2026-w43');
  assert.equal(await new DynamoRepo(fakeClient()).getLeagueResultSeen('u1'), null);
});
