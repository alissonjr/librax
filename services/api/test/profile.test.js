import { test } from 'node:test';
import assert from 'node:assert/strict';

import { cleanDisplayName, parseProfileUpdate, DISPLAY_NAME_MAX } from '../src/domain/profile.js';
import { makeProfileHandlers } from '../src/handlers/profile.js';
import * as profileHandlers from '../src/handlers/profile.js';
import { updateProfile } from '../src/usecases/profile.js';
import { completeLesson } from '../src/usecases/completeLesson.js';
import { createSquad, joinSquad } from '../src/usecases/squads.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// PUT /v1/users/me/profile: o nome do onboarding chega ao servidor (rankings da liga, das squads
// e o global) e a pessoa escolhe aparecer ou nao no ranking global.

const content = { lessons: { 'u1-l1': { id: 'u1-l1', xpReward: 10 } }, achievementRules: [] };
const thu43 = new Date('2026-10-22T15:00:00Z');
const W44 = new Date('2026-10-27T15:00:00Z');

function event({ sub = 'u1', body } = {}) {
  return {
    requestContext: { authorizer: sub ? { jwt: { claims: { sub } } } : undefined },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}
const parse = (res) => JSON.parse(res.body);

const study = (repo, userId, at = thu43) =>
  completeLesson(repo, content, { userId, lessonId: 'u1-l1', today: at.toISOString().slice(0, 10), score: 1, now: at.getTime() });

// --- dominio ---

test('cleanDisplayName: apara, junta espacos e tira controle e invisiveis', () => {
  assert.equal(cleanDisplayName('  Ana   Clara  '), 'Ana Clara');
  assert.equal(cleanDisplayName('Ana\nClara\tSilva'), 'Ana Clara Silva');
  assert.equal(cleanDisplayName('Bi\u0000a​'), 'Bia');
  assert.equal(cleanDisplayName('‮aiB'), 'aiB'); // inversao de direcao sai
  assert.equal(cleanDisplayName('João'), 'João'); // NFC
});

test('cleanDisplayName: de 1 a 30 caracteres depois da limpeza (acento e emoji valem um)', () => {
  assert.equal(cleanDisplayName('A'), 'A');
  assert.equal(cleanDisplayName('a'.repeat(DISPLAY_NAME_MAX)), 'a'.repeat(30));
  assert.equal(cleanDisplayName('a'.repeat(31)), null);
  assert.equal(cleanDisplayName('\u{1F44B}'.repeat(30)).length, 60); // 30 caracteres, 60 unidades UTF-16
  for (const bad of ['', '   ', '​​', null, 42, ['Ana'], { name: 'Ana' }]) {
    assert.equal(cleanDisplayName(bad), null, JSON.stringify(bad));
  }
});

test('parseProfileUpdate: pelo menos um campo, cada um no tipo certo', () => {
  assert.deepEqual(parseProfileUpdate({ displayName: ' Bia ' }), { ok: true, changes: { displayName: 'Bia' } });
  assert.deepEqual(parseProfileUpdate({ showInGlobalRanking: false, extra: 1 }), { ok: true, changes: { showInGlobalRanking: false } });
  assert.deepEqual(parseProfileUpdate({ displayName: 'Bia', showInGlobalRanking: true }), {
    ok: true,
    changes: { displayName: 'Bia', showInGlobalRanking: true },
  });
  assert.equal(parseProfileUpdate({}).error, 'NO_CHANGES');
  assert.equal(parseProfileUpdate(null).error, 'NO_CHANGES');
  assert.equal(parseProfileUpdate([]).error, 'NO_CHANGES');
  assert.equal(parseProfileUpdate({ displayName: '' }).error, 'INVALID_NAME');
  assert.equal(parseProfileUpdate({ displayName: null }).error, 'INVALID_NAME');
  assert.equal(parseProfileUpdate({ showInGlobalRanking: 'no' }).error, 'INVALID_RANKING_CHOICE');
});

// --- usecase ---

test('updateProfile: sem perfil ainda cria com o padrao e grava o nome', async () => {
  const repo = new InMemoryRepo();
  const r = await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia' }, nowMs: thu43.getTime() });
  assert.deepEqual(r, { displayName: 'Bia', showInGlobalRanking: true });
  const profile = await repo.getProfile('u1');
  assert.equal(profile.displayName, 'Bia');
  assert.equal(profile.xpTotal, 0);
  assert.equal(await repo.hasGlobalRankingEntry('u1'), true);
});

test('updateProfile: perfil criado por outra requisicao no meio nao e coberto (XP fica)', async () => {
  const repo = new InMemoryRepo();
  // a migracao do convidado cria o perfil entre a leitura e a criacao
  const getProfile = repo.getProfile.bind(repo);
  let first = true;
  repo.getProfile = async (userId) => {
    if (first) {
      first = false;
      await study(repo, userId);
      return null;
    }
    return getProfile(userId);
  };
  await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia' }, nowMs: thu43.getTime() });
  const profile = await getProfile('u1');
  assert.equal(profile.xpTotal, 10);
  assert.equal(profile.displayName, 'Bia');
});

test('updateProfile: so a escolha do ranking nao mexe no nome e tira a entrada', async () => {
  const repo = new InMemoryRepo();
  await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia' }, nowMs: thu43.getTime() });
  const r = await updateProfile(repo, { userId: 'u1', changes: { showInGlobalRanking: false }, nowMs: thu43.getTime() });
  assert.deepEqual(r, { displayName: 'Bia', showInGlobalRanking: false });
  assert.equal(await repo.hasGlobalRankingEntry('u1'), false);
  // e volta
  await updateProfile(repo, { userId: 'u1', changes: { showInGlobalRanking: true }, nowMs: thu43.getTime() });
  assert.equal(await repo.hasGlobalRankingEntry('u1'), true);
});

test('updateProfile: o nome novo vai para a liga da semana e para todas as squads', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1'); // entra na liga da semana
  await repo.seedProfile({ userId: 'u2' });
  const squad = await createSquad(repo, { userId: 'u2', isGuest: false, name: 'Turma', type: 'private', genId: () => 's1', rng: () => 0 });
  await joinSquad(repo, { userId: 'u1', isGuest: false, code: squad.inviteCode });
  const seat = await repo.getLeaguePlacement('u1', '2026-w43');

  await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia' }, nowMs: thu43.getTime() });

  const leagueRow = (await repo.listLeagueMembers(seat.leagueId)).find((m) => m.userId === 'u1');
  assert.equal(leagueRow.displayName, 'Bia');
  assert.equal((await repo.getMember('s1', 'u1')).displayName, 'Bia');
  // quem nao trocou o nome fica como estava
  assert.equal((await repo.getMember('s1', 'u2')).displayName, undefined);
});

test('updateProfile: na semana seguinte (sem vaga ainda) so as squads mudam', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1'); // liga da semana 43
  const seat43 = await repo.getLeaguePlacement('u1', '2026-w43');
  await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia' }, nowMs: W44.getTime() });
  const row = (await repo.listLeagueMembers(seat43.leagueId)).find((m) => m.userId === 'u1');
  assert.equal(row.displayName, undefined); // liga encerrada fica como foi
});

test('licao concluida depois nao volta o nome nem relista quem saiu do ranking', async () => {
  const repo = new InMemoryRepo();
  await study(repo, 'u1');
  const stale = { ...(await repo.getProfile('u1')) }; // copia lida antes da troca
  await updateProfile(repo, { userId: 'u1', changes: { displayName: 'Bia', showInGlobalRanking: false }, nowMs: thu43.getTime() });

  await repo.saveProfile({ ...stale, xpTotal: stale.xpTotal + 10 });

  const profile = await repo.getProfile('u1');
  assert.equal(profile.displayName, 'Bia');
  assert.equal(profile.showInGlobalRanking, false);
  assert.equal(profile.xpTotal, 20);
  assert.equal(await repo.hasGlobalRankingEntry('u1'), false);
});

// --- handler ---

test('PUT /v1/users/me/profile exporta handler de producao e exige token', async () => {
  assert.equal(typeof profileHandlers.updateProfileHandler, 'function');
  const h = makeProfileHandlers({ repo: new InMemoryRepo(), now: () => thu43 });
  assert.equal((await h.updateProfileHandler(event({ sub: null, body: { displayName: 'Bia' } }))).statusCode, 401);
});

test('PUT /v1/users/me/profile: 200 com o nome limpo e a escolha (padrao ligado)', async () => {
  const repo = new InMemoryRepo();
  const h = makeProfileHandlers({ repo, now: () => thu43 });
  const res = await h.updateProfileHandler(event({ body: { displayName: '  Ana   Clara ' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { displayName: 'Ana Clara', showInGlobalRanking: true });

  const off = await h.updateProfileHandler(event({ body: { showInGlobalRanking: false } }));
  assert.deepEqual(parse(off), { displayName: 'Ana Clara', showInGlobalRanking: false });
});

test('PUT /v1/users/me/profile: 400 com o codigo da validacao, sem gravar nada', async () => {
  const repo = new InMemoryRepo();
  const h = makeProfileHandlers({ repo, now: () => thu43 });
  for (const [b, code] of [
    [{ displayName: 'a'.repeat(31) }, 'INVALID_NAME'],
    [{ displayName: '   ' }, 'INVALID_NAME'],
    [{ showInGlobalRanking: 1 }, 'INVALID_RANKING_CHOICE'],
    [{}, 'NO_CHANGES'],
  ]) {
    const res = await h.updateProfileHandler(event({ body: b }));
    assert.equal(res.statusCode, 400, JSON.stringify(b));
    assert.equal(parse(res).error.code, code);
  }
  assert.equal((await h.updateProfileHandler(event({}))).statusCode, 400); // sem corpo
  assert.equal((await h.updateProfileHandler(event({ body: { displayName: 'x'.repeat(2000) } }))).statusCode, 413);
  assert.equal(await repo.getProfile('u1'), null);
});
