import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { DynamoRepo } from '../src/adapters/dynamoRepo.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { resetSquadWeek } from '../src/usecases/resetSquadWeek.js';
import { createSquad, joinSquad } from '../src/usecases/squads.js';
import { makeSquadHandlers } from '../src/handlers/squads.js';
import { makeCloseLeagueHandler } from '../src/handlers/closeLeague.js';

// Reset semanal das squads (SPEC 04 secoes 0.3 e 8): no mesmo job que fecha as ligas, o XP
// semanal da squad e dos membros volta a zero e a semana fica guardada com o ranking interno
// (SQUAD#<id> / WEEK#<semana>). Idempotente e sem apagar XP que ja entrou na semana nova.

const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
const W43 = Date.parse('2026-10-19T00:00:00Z');
const thu43 = Date.parse('2026-10-22T15:00:00Z');
const mon44 = Date.parse('2026-10-26T10:00:00Z');
const closedAt = '2026-10-26T00:05:00.000Z';

const study = (repo, userId, nowMs, times = 1) =>
  (async () => {
    for (let i = 0; i < times; i++) {
      await completeLesson(repo, content, {
        userId, lessonId: 'u1-l1', today: new Date(nowMs).toISOString().slice(0, 10), score: 1, now: nowMs,
      });
    }
  })();

async function squadOf(repo, ...userIds) {
  const [admin, ...rest] = userIds;
  await createSquad(repo, { userId: admin, isGuest: false, name: 'Coda de Libras', genId: () => 's1', rng: () => 0 });
  for (const userId of rest) await joinSquad(repo, { userId, isGuest: false, squadId: 's1' });
}

test('o job zera o XP semanal da squad e dos membros e guarda a semana com o ranking', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1', 'u2', 'u3');
  await study(repo, 'u1', thu43, 1);
  await study(repo, 'u2', thu43, 3);

  const report = await resetSquadWeek(repo, { periodStart: W43, closedAt });

  assert.deepEqual(report, { period: '2026-w43', pages: 1, squads: 1, skipped: 0, members: 3, xp: 40 });
  const squad = await repo.getSquad('s1');
  assert.equal(squad.xpWeekly, 0);
  assert.equal(squad.xpAllTime, 40); // historico total continua
  assert.equal((await repo.getMember('s1', 'u2')).xpWeeklyContrib, 0);
  assert.equal((await repo.getMember('s1', 'u2')).xpAllTimeContrib, 30);

  const week = await repo.getSquadWeek('s1', '2026-w43');
  assert.equal(week.status, 'closed');
  assert.equal(week.xpWeekly, 40);
  assert.equal(week.memberCount, 3);
  assert.equal(week.closedAt, closedAt);
  assert.deepEqual(week.ranking, [
    { userId: 'u2', xp: 30, rank: 1 },
    { userId: 'u1', xp: 10, rank: 2 },
    { userId: 'u3', xp: 0, rank: 3 },
  ]);
});

test('rodar de novo nao muda nada (idempotente)', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1', 'u2');
  await study(repo, 'u1', thu43, 2);

  await resetSquadWeek(repo, { periodStart: W43, closedAt });
  const again = await resetSquadWeek(repo, { periodStart: W43, closedAt: 'depois' });

  assert.equal(again.squads, 0);
  assert.equal(again.skipped, 1);
  const week = await repo.getSquadWeek('s1', '2026-w43');
  assert.equal(week.xpWeekly, 20);
  assert.equal(week.closedAt, closedAt);
});

test('licao na semana nova antes do job: o XP novo fica e a semana velha sai certa', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1', 'u2');
  await study(repo, 'u1', thu43, 2);
  await study(repo, 'u2', thu43, 1);
  await study(repo, 'u1', Date.parse('2026-10-26T00:01:00Z'), 1); // antes do job de 00:05

  await resetSquadWeek(repo, { periodStart: W43, closedAt });

  assert.equal((await repo.getSquad('s1')).xpWeekly, 10);
  assert.equal((await repo.getMember('s1', 'u1')).xpWeeklyContrib, 10);
  const week = await repo.getSquadWeek('s1', '2026-w43');
  assert.equal(week.xpWeekly, 30);
  assert.deepEqual(week.ranking.map((r) => [r.userId, r.xp]), [['u1', 20], ['u2', 10]]);
});

test('job cai no meio e uma licao entra antes da nova tentativa: a semana velha nao se perde', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1', 'u2');
  await study(repo, 'u2', thu43, 2);
  const save = repo.saveSquadWeek.bind(repo);
  let failures = 1;
  repo.saveSquadWeek = async (...args) => {
    if (failures-- > 0) throw new Error('timeout');
    return save(...args);
  };

  await assert.rejects(() => resetSquadWeek(repo, { periodStart: W43, closedAt }), /timeout/);
  await study(repo, 'u2', mon44, 1);
  await resetSquadWeek(repo, { periodStart: W43, closedAt });

  const week = await repo.getSquadWeek('s1', '2026-w43');
  assert.equal(week.xpWeekly, 20);
  assert.deepEqual(week.ranking[0], { userId: 'u2', xp: 20, rank: 1 });
  assert.equal((await repo.getSquad('s1')).xpWeekly, 10);
});

test('squad sem XP na semana nao entra no job', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1');
  const report = await resetSquadWeek(repo, { periodStart: W43, closedAt });
  assert.equal(report.squads, 0);
  assert.equal(await repo.getSquadWeek('s1', '2026-w43'), null);
});

test('licao de outra semana soma so no total da squad, nao no semanal', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1');
  await completeLesson(repo, content, { userId: 'u1', lessonId: 'u1-l1', today: '2026-09-01', score: 1, now: thu43 });
  const squad = await repo.getSquad('s1');
  assert.equal(squad.xpWeekly ?? 0, 0);
  assert.equal(squad.xpAllTime, 10);
});

test('GET da squad e das minhas squads mostram zero se a semana virou e o job ainda nao rodou', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1', 'u2');
  await study(repo, 'u2', thu43, 2);
  const h = makeSquadHandlers({ repo, now: () => new Date(mon44) });
  const ev = { requestContext: { authorizer: { jwt: { claims: { sub: 'u1' } } } }, pathParameters: { squadId: 's1' } };

  const detail = JSON.parse((await h.getSquadHandler(ev)).body);
  assert.equal(detail.squad.xpWeekly, 0);
  assert.deepEqual(detail.members.map((m) => m.xpWeeklyContrib), [0, 0]);
  const mine = JSON.parse((await h.listMySquadsHandler(ev)).body);
  assert.equal(mine.squads[0].xpWeekly, 0);
});

test('a Lambda semanal fecha as ligas e reseta as squads na mesma execucao', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1');
  await study(repo, 'u1', thu43, 1);
  const { handler } = makeCloseLeagueHandler({ repo, now: () => new Date('2026-10-26T00:05:00Z') });

  const report = await handler({});

  assert.equal(report.period, '2026-w43');
  assert.equal(report.closed, 1); // liga Bronze em que u1 entrou
  assert.equal(report.squads.squads, 1);
  assert.equal((await repo.getSquad('s1')).xpWeekly, 0);
});

test('dissolver a squad apaga tambem o historico semanal', async () => {
  const repo = new InMemoryRepo();
  await squadOf(repo, 'u1');
  await study(repo, 'u1', thu43, 1);
  await resetSquadWeek(repo, { periodStart: W43, closedAt });
  await repo.deleteSquad('s1');
  assert.equal(await repo.getSquadWeek('s1', '2026-w43'), null);
});

// --- formato dos comandos do DynamoRepo ---

function fakeClient(responder = () => ({})) {
  const calls = [];
  return {
    calls,
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      return responder(cmd.constructor.name, cmd.input, calls.length);
    },
  };
}
const conditionFailed = () => Object.assign(new Error('condicao'), { name: 'ConditionalCheckFailedException' });

test('DynamoRepo: XP da semana corrente e um ADD condicional a semana do item', async () => {
  const db = fakeClient();
  await new DynamoRepo(db).incrementSquadXp('s1', 'u1', 10, { period: '2026-w43' });

  assert.equal(db.calls.length, 2);
  for (const { name, input } of db.calls) {
    assert.equal(name, 'UpdateCommand');
    assert.equal(input.ConditionExpression, 'attribute_exists(PK) AND xpWeekPeriod = :p');
    assert.equal(input.ExpressionAttributeValues[':p'], '2026-w43');
  }
  assert.match(db.calls[0].input.UpdateExpression, /^ADD xpWeekly :d, xpAllTime :d$/);
  assert.match(db.calls[1].input.UpdateExpression, /^ADD xpWeeklyContrib :d, xpAllTimeContrib :d$/);
});

test('DynamoRepo: primeira licao da semana vira a semana do item e marca a squad como ativa', async () => {
  const db = fakeClient((name, input) => {
    if (name === 'UpdateCommand' && input.ConditionExpression.endsWith('xpWeekPeriod = :p')) throw conditionFailed();
    if (name === 'GetCommand') return { Item: { ...input.Key, xpWeekly: 30, xpWeekPeriod: '2026-w42' } };
    return {};
  });
  await new DynamoRepo(db).incrementSquadXp('s1', 'u1', 10, { period: '2026-w43' });

  const tx = db.calls.find((c) => c.name === 'TransactWriteCommand');
  const [roll, marker] = tx.input.TransactItems.map((t) => t.Update);
  assert.deepEqual(roll.Key, { PK: 'SQUAD#s1', SK: 'META' });
  assert.match(roll.UpdateExpression, /lastWeekXp = if_not_exists\(xpWeekly, :zero\), lastWeekPeriod = xpWeekPeriod/);
  assert.match(roll.UpdateExpression, /xpWeekly = :d, xpWeekPeriod = :p ADD xpAllTime :d/);
  assert.equal(roll.ConditionExpression, 'xpWeekPeriod = :prev');
  assert.equal(roll.ExpressionAttributeValues[':prev'], '2026-w42');
  assert.deepEqual(marker.Key, { PK: 'SQUAD#s1', SK: 'WEEK#2026-w43' });
  assert.equal(marker.ExpressionAttributeValues[':g2pk'], 'SQUADS#2026-w43');
  assert.equal(marker.ExpressionAttributeValues[':g2sk'], 'SQUAD#s1');

  const memberRoll = db.calls.find((c) => c.name === 'UpdateCommand' && c.input.Key.SK === 'MEMBER#u1' && /lastWeekXp/.test(c.input.UpdateExpression));
  assert.ok(memberRoll, 'o membro vira a semana sem marcador');
});

test('DynamoRepo: membro que saiu no meio nao vira item solto', async () => {
  const db = fakeClient((name) => {
    if (name === 'UpdateCommand') throw conditionFailed();
    return {}; // GetCommand sem Item
  });
  await new DynamoRepo(db).incrementSquadXp('s1', 'u1', 10, { period: '2026-w43' });
  assert.equal(db.calls.filter((c) => c.name === 'UpdateCommand').length, 2);
});

test('DynamoRepo: o job vira a semana so de quem ainda esta nela e lista as squads pelo GSI2', async () => {
  const db = fakeClient((name) => {
    if (name === 'QueryCommand') return { Items: [{ PK: 'SQUAD#s1', SK: 'MEMBER#u1', userId: 'u1' }] };
    return {};
  });
  const repo = new DynamoRepo(db);
  await repo.rollSquadWeek('s1', '2026-w43');

  const rolls = db.calls.filter((c) => c.name === 'UpdateCommand');
  assert.deepEqual(rolls.map((c) => c.input.Key.SK), ['META', 'MEMBER#u1']);
  assert.equal(rolls[0].input.ConditionExpression, 'xpWeekPeriod = :old');
  assert.match(rolls[0].input.UpdateExpression, /SET lastWeekXp = xpWeekly, lastWeekPeriod = :old, xpWeekly = :zero REMOVE xpWeekPeriod/);
  assert.match(rolls[1].input.UpdateExpression, /xpWeeklyContrib = :zero/);

  const page = fakeClient(() => ({
    Items: [{ PK: 'SQUAD#s1', SK: 'WEEK#2026-w43', GSI2PK: 'SQUADS#2026-w43', squadId: 's1', period: '2026-w43', status: 'open' }],
    LastEvaluatedKey: { k: 1 },
  }));
  const r = await new DynamoRepo(page).listSquadWeeks('2026-w43', { limit: 10, cursor: { k: 0 } });
  assert.equal(page.calls[0].input.IndexName, 'GSI2');
  assert.equal(page.calls[0].input.ExpressionAttributeValues[':pk'], 'SQUADS#2026-w43');
  assert.deepEqual(r, { weeks: [{ squadId: 's1', period: '2026-w43', status: 'open' }], cursor: { k: 1 } });
});

test('DynamoRepo: a semana fecha uma vez so', async () => {
  const db = fakeClient();
  assert.equal(await new DynamoRepo(db).saveSquadWeek('s1', '2026-w43', { xpWeekly: 40, ranking: [] }), true);
  const { input } = db.calls[0];
  assert.deepEqual(input.Key, { PK: 'SQUAD#s1', SK: 'WEEK#2026-w43' });
  assert.equal(input.ConditionExpression, 'attribute_not_exists(#status) OR #status <> :closed');

  const closed = fakeClient(() => {
    throw conditionFailed();
  });
  assert.equal(await new DynamoRepo(closed).saveSquadWeek('s1', '2026-w43', { xpWeekly: 40 }), false);
});

test('DynamoRepo: dissolver apaga tudo da particao da squad (inclusive WEEK#)', async () => {
  const db = fakeClient((name) => {
    if (name === 'GetCommand') return { Item: { PK: 'SQUAD#s1', SK: 'META', squadId: 's1', inviteCode: 'ABC234' } };
    if (name === 'QueryCommand') {
      return { Items: [
        { PK: 'SQUAD#s1', SK: 'META' },
        { PK: 'SQUAD#s1', SK: 'MEMBER#u1', userId: 'u1' },
        { PK: 'SQUAD#s1', SK: 'WEEK#2026-w43' },
      ] };
    }
    return {};
  });
  await new DynamoRepo(db).deleteSquad('s1');
  const query = db.calls.find((c) => c.name === 'QueryCommand');
  assert.equal(query.input.KeyConditionExpression, 'PK = :pk');
  const tx = db.calls.find((c) => c.name === 'TransactWriteCommand');
  const keys = tx.input.TransactItems.map((i) => `${i.Delete.Key.PK}|${i.Delete.Key.SK}`);
  assert.deepEqual(keys.sort(), [
    'INVITE#ABC234|META', 'SQUAD#s1|MEMBER#u1', 'SQUAD#s1|META', 'SQUAD#s1|WEEK#2026-w43', 'USER#u1|SQUAD#s1',
  ]);
});
