import { test } from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { accountDeletionOutcome } from '../src/domain/squads.js';
import { deleteAccount } from '../src/usecases/deleteAccount.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { closeLeagueWeek } from '../src/usecases/closeLeagueWeek.js';
import { createSquad, joinSquad } from '../src/usecases/squads.js';
import { makeAccountHandlers } from '../src/handlers/account.js';
import * as accountHandlers from '../src/handlers/account.js';

// Exclusao de conta (LGPD, DELETE /v1/users/me): tudo o que guarda o id da pessoa sai da tabela,
// as squads e ligas dos outros continuam certas e o Cognito e o ultimo passo. Repo em memoria.

const content = {
  lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10, signs: ['letra-A'] } },
  achievementRules: [{ code: 'first_lesson', type: 'lessons_completed', threshold: 1 }],
};
const W43 = Date.parse('2026-10-19T00:00:00Z');
const thu43 = Date.parse('2026-10-22T15:00:00Z');
const tue44 = Date.parse('2026-10-27T15:00:00Z');
const lesson = (userId, nowMs) => ({
  userId,
  lessonId: 'u1-l1',
  today: new Date(nowMs).toISOString().slice(0, 10),
  score: 1,
  now: nowMs,
  reviewed: [{ signId: 'letra-A', result: { state: 'correct' } }],
});
const rng0 = () => 0;

/** Diretorio falso do Cognito: guarda quem foi apagado e responde como o AdminDeleteUser. */
function fakeDirectory({ failTimes = 0 } = {}) {
  const users = new Set(['u1-cognito']);
  const calls = [];
  return {
    calls,
    users,
    async deleteUser(username) {
      calls.push(username);
      if (failTimes > 0) {
        failTimes -= 1;
        throw new Error('Cognito fora do ar');
      }
      return users.delete(username);
    },
  };
}

/**
 * u1 com progresso, Web Push, lembrete, liga fechada (w43) e aberta (w44) junto com u5, e tres
 * squads: s-solo (so u1), s-admin (u1 unico admin, u2 entrou antes de u3) e s-membro (admin u4).
 */
async function setup() {
  const repo = new InMemoryRepo();
  let n = 0;
  const create = (userId, squadId, now) =>
    createSquad(repo, { userId, isGuest: false, name: 'Coda de Libras', type: 'public', genId: () => squadId, rng: () => (n++ % 30) / 30, now });
  await create('u1', 's-solo', '2026-10-01T00:00:00Z');
  await create('u1', 's-admin', '2026-10-01T00:00:00Z');
  await joinSquad(repo, { userId: 'u3', isGuest: false, squadId: 's-admin', now: '2026-10-03T00:00:00Z' });
  await joinSquad(repo, { userId: 'u2', isGuest: false, squadId: 's-admin', now: '2026-10-02T00:00:00Z' });
  await create('u4', 's-membro', '2026-10-01T00:00:00Z');
  await joinSquad(repo, { userId: 'u1', isGuest: false, squadId: 's-membro', now: '2026-10-02T00:00:00Z' });
  await repo.saveSquadWeek('s-admin', '2026-w42', {
    xpWeekly: 30, memberCount: 3,
    ranking: [{ userId: 'u1', xp: 20, rank: 1 }, { userId: 'u2', xp: 10, rank: 2 }],
  });

  for (const userId of ['u1', 'u5']) await completeLesson(repo, content, lesson(userId, thu43));
  await closeLeagueWeek(repo, { periodStart: W43, closedAt: '2026-10-26T00:05:00.000Z' });
  for (const userId of ['u1', 'u5']) await completeLesson(repo, content, lesson(userId, tue44));

  await repo.claimLessonAttempt('u1', 'attempt-0001', { lessonId: 'u1-l1' });
  await repo.putPushSubscription('u1', 'abc123', { endpoint: 'https://fcm.googleapis.com/x', keys: {} });
  await repo.saveNotifState('u1', { reminderHour: 19, timezone: 'America/Sao_Paulo' });
  await repo.markLeagueResultSeen('u1', '2026-w43');
  await repo.markActivity('u1', { day: '2026-10-27', week: '2026-w44', month: '2026-10' });
  return { repo, inviteSolo: (await repo.getSquad('s-solo')).inviteCode };
}

// --- dominio ---

test('accountDeletionOutcome: sozinho dissolve, unico admin passa para o mais antigo, com outro admin so sai', () => {
  assert.deepEqual(accountDeletionOutcome({ others: [] }), { action: 'dissolve' });
  assert.deepEqual(
    accountDeletionOutcome({
      others: [
        { userId: 'u3', role: 'member', joinedAt: '2026-10-03T00:00:00Z' },
        { userId: 'u2', role: 'member', joinedAt: '2026-10-02T00:00:00Z' },
      ],
    }),
    { action: 'remove', promote: 'u2' },
  );
  assert.deepEqual(
    accountDeletionOutcome({ others: [{ userId: 'u2', role: 'member' }, { userId: 'u4', role: 'admin' }] }),
    { action: 'remove', promote: null },
  );
  // sem joinedAt (seeds antigos) fica por ultimo; empate pelo userId
  assert.equal(
    accountDeletionOutcome({ others: [{ userId: 'b' }, { userId: 'c', joinedAt: '2026-10-05T00:00:00Z' }, { userId: 'a' }] }).promote,
    'c',
  );
  assert.equal(accountDeletionOutcome({ others: [{ userId: 'b' }, { userId: 'a' }] }).promote, 'a');
});

// --- usecase ---

test('deleteAccount apaga a particao inteira e o usuario no Cognito por ultimo', async () => {
  const { repo } = await setup();
  const directory = fakeDirectory();
  const { bucket } = await repo.getNotifState('u1');

  const report = await deleteAccount(repo, { userId: 'u1', username: 'u1-cognito', directory });
  assert.equal(report.cognito, true);
  assert.deepEqual(directory.calls, ['u1-cognito']);
  assert.ok(report.items > 0);

  assert.equal(await repo.getProfile('u1'), null);
  assert.deepEqual(await repo.listProgress('u1'), []);
  assert.deepEqual(await repo.listSrsItems('u1'), []);
  assert.equal(await repo.hasDayLog('u1', '2026-10-27'), false);
  assert.deepEqual(await repo.listEarnedAchievements('u1'), []);
  assert.deepEqual(await repo.listUserSquads('u1'), []);
  assert.equal(await repo.getLeagueState('u1'), null);
  assert.equal(await repo.getLeaguePlacement('u1', '2026-w44'), null);
  assert.equal(await repo.getLeagueResultSeen('u1'), null);
  assert.equal(await repo.getUserLeague('u1'), null);
  assert.equal(await repo.getLessonAttempt('u1', 'attempt-0001'), null);
  assert.deepEqual(await repo.listPushSubscriptions('u1'), []);
  assert.equal(await repo.getNotifState('u1'), null);
  assert.deepEqual(await repo.listNotifCandidates(bucket), []); // sai da rodada de lembretes
  assert.equal(await repo.getActivity('u1'), null);
  assert.deepEqual(await repo.listUserLeagueIds('u1'), []);

  // a outra pessoa nao perde nada
  assert.equal((await repo.getProfile('u5')).xpTotal, 20);
});

test('deleteAccount: squad so dela dissolve; unico admin passa para o membro mais antigo; membro comum so sai', async () => {
  const { repo, inviteSolo } = await setup();
  const report = await deleteAccount(repo, { userId: 'u1', directory: fakeDirectory() });
  assert.deepEqual(
    { left: report.squadsLeft, dissolved: report.squadsDissolved, promoted: report.squadsPromoted },
    { left: 2, dissolved: 1, promoted: 1 },
  );

  assert.equal(await repo.getSquad('s-solo'), null);
  assert.equal(await repo.findSquadIdByInvite(inviteSolo), null);

  const sAdmin = await repo.getSquad('s-admin');
  assert.equal(sAdmin.memberCount, 2);
  assert.equal(sAdmin.createdBy, undefined); // o id da pessoa sai do META
  assert.equal((await repo.getMember('s-admin', 'u2')).role, 'admin'); // entrou antes do u3
  assert.equal((await repo.getMember('s-admin', 'u3')).role, 'member');
  assert.equal(await repo.getMember('s-admin', 'u1'), null);
  const week = await repo.getSquadWeek('s-admin', '2026-w42');
  assert.deepEqual(week.ranking, [{ userId: 'u2', xp: 10, rank: 2 }]); // a posicao dos outros fica
  assert.equal(week.xpWeekly, 30); // total agregado fica

  const sMembro = await repo.getSquad('s-membro');
  assert.equal(sMembro.memberCount, 1);
  assert.equal(sMembro.createdBy, 'u4');
  assert.equal((await repo.getMember('s-membro', 'u4')).role, 'admin');
});

test('deleteAccount: sai do ranking das ligas sem mexer no resultado dos outros', async () => {
  const { repo } = await setup();
  const openId = (await repo.getLeaguePlacement('u5', '2026-w44')).leagueId;
  const closedId = (await repo.getLeaguePlacement('u5', '2026-w43')).leagueId;
  const closedBefore = await repo.getLeague(closedId);
  const u5Result = await repo.getLeagueState('u5');
  assert.equal((await repo.getLeague(openId)).memberCount, 2);

  await deleteAccount(repo, { userId: 'u1', directory: fakeDirectory() });

  assert.deepEqual((await repo.listLeagueMembers(openId)).map((m) => m.userId), ['u5']);
  assert.equal((await repo.getLeague(openId)).memberCount, 1); // vaga liberada na liga aberta
  assert.deepEqual((await repo.listLeagueMembers(closedId)).map((m) => m.userId), ['u5']);
  assert.deepEqual(await repo.getLeague(closedId), closedBefore); // fechada: totais como estavam
  assert.deepEqual(await repo.getLeagueState('u5'), u5Result);
});

test('deleteAccount e idempotente: repetir nao desconta de novo nem falha', async () => {
  const { repo } = await setup();
  const directory = fakeDirectory();
  const openId = (await repo.getLeaguePlacement('u5', '2026-w44')).leagueId;
  await deleteAccount(repo, { userId: 'u1', username: 'u1-cognito', directory });

  const again = await deleteAccount(repo, { userId: 'u1', username: 'u1-cognito', directory });
  assert.deepEqual(again, { squadsLeft: 0, squadsDissolved: 0, squadsPromoted: 0, leagues: 0, items: 0, cognito: false });
  assert.equal((await repo.getSquad('s-admin')).memberCount, 2);
  assert.equal((await repo.getLeague(openId)).memberCount, 1);
});

test('deleteAccount: queda no meio, a nova tentativa termina sem contar duas vezes', async () => {
  const { repo } = await setup();
  const openId = (await repo.getLeaguePlacement('u5', '2026-w44')).leagueId;

  // cai depois das squads e de uma liga, antes da particao
  const removeLeagueMember = repo.removeLeagueMember.bind(repo);
  let calls = 0;
  repo.removeLeagueMember = async (...args) => {
    calls += 1;
    if (calls === 2) throw new Error('DynamoDB fora do ar');
    return removeLeagueMember(...args);
  };
  await assert.rejects(() => deleteAccount(repo, { userId: 'u1', directory: fakeDirectory() }), /fora do ar/);
  assert.ok(await repo.getProfile('u1')); // nada da particao saiu ainda

  // e o Cognito tambem falha uma vez: os dados saem, o usuario fica para a nova tentativa
  const directory = fakeDirectory({ failTimes: 1 });
  await assert.rejects(() => deleteAccount(repo, { userId: 'u1', username: 'u1-cognito', directory }), /Cognito/);
  assert.equal(await repo.getProfile('u1'), null);
  assert.ok(directory.users.has('u1-cognito'));

  const report = await deleteAccount(repo, { userId: 'u1', username: 'u1-cognito', directory });
  assert.equal(report.cognito, true);
  assert.equal(directory.users.size, 0);
  assert.equal((await repo.getSquad('s-admin')).memberCount, 2);
  assert.equal((await repo.getSquad('s-membro')).memberCount, 1);
  assert.equal((await repo.getLeague(openId)).memberCount, 1);
  assert.deepEqual(await repo.listUserLeagueIds('u1'), []);
});

test('deleteAccount nao mexe nos contadores agregados do painel (OPS, sem id de ninguem)', async () => {
  const { repo } = await setup();
  await repo.addOpsCounters('DAY#2026-10-27', { active: 2, lessons: 2 });
  const before = await repo.getOpsItem('DAY#2026-10-27');
  await deleteAccount(repo, { userId: 'u1', directory: fakeDirectory() });
  assert.deepEqual(await repo.getOpsItem('DAY#2026-10-27'), before);
});

// --- handler ---

const ev = (claims) => ({ requestContext: { authorizer: claims ? { jwt: { claims } } : undefined } });

test('o handler de producao existe (nada de import indefinido)', () => {
  assert.equal(typeof accountHandlers.deleteAccountHandler, 'function');
});

test('DELETE /v1/users/me: apaga com o cognito:username do token e responde 200', async () => {
  const { repo } = await setup();
  const directory = fakeDirectory();
  const logs = [];
  const h = makeAccountHandlers({ repo, directory, log: (...a) => logs.push(a.join(' ')) });

  const res = await h.deleteAccountHandler(ev({ sub: 'u1', 'cognito:username': 'u1-cognito' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
  assert.deepEqual(directory.calls, ['u1-cognito']);
  assert.equal(await repo.getProfile('u1'), null);
  // o log leva so contagens, sem o id da pessoa
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs[0], /u1/);

  // de novo (resposta perdida, segundo toque): 200 do mesmo jeito
  assert.equal((await h.deleteAccountHandler(ev({ sub: 'u1', 'cognito:username': 'u1-cognito' }))).statusCode, 200);
});

test('DELETE /v1/users/me: sem cognito:username usa o sub; sem token 401; falha 500 sem detalhe', async () => {
  const { repo } = await setup();
  const directory = fakeDirectory();
  const h = makeAccountHandlers({ repo, directory, log: () => {} });
  await h.deleteAccountHandler(ev({ sub: 'u5' }));
  assert.deepEqual(directory.calls, ['u5']);

  assert.equal((await h.deleteAccountHandler(ev(null))).statusCode, 401);
  assert.ok(await repo.getProfile('u1'));

  const broken = makeAccountHandlers({ repo, directory: fakeDirectory({ failTimes: 1 }), log: () => {} });
  const res = await broken.deleteAccountHandler(ev({ sub: 'u1', 'cognito:username': 'u1-cognito' }));
  assert.equal(res.statusCode, 500);
  assert.equal(JSON.parse(res.body).error.code, 'INTERNAL_ERROR');
});
