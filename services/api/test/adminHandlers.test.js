import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeAdminHandlers, encodeCursor } from '../src/handlers/admin.js';
import { groupsOf, isAdmin, parseAccountQuery, isFederated, makeMfaGate, MFA_CACHE_MS } from '../src/domain/admin.js';
import { CognitoDirectory, accountFromCognito } from '../src/adapters/cognitoDirectory.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';
import { recordLessonCompleted } from '../src/usecases/opsMetrics.js';
import { createSquad } from '../src/usecases/squads.js';

// Painel de administracao: so leitura, e so para o grupo `admin` do Cognito. A Lambda confere o
// grupo no token (cognito:groups): esconder a tela nao basta.

const ADMIN = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const now = () => new Date('2026-10-23T15:00:00Z');

function event({ routeKey, sub = ADMIN, groups = '[admin]', email = 'dono@librax.example', query, pathParameters, extraClaims = {} } = {}) {
  const claims = { sub, email, ...(groups === null ? {} : { 'cognito:groups': groups }), ...extraClaims };
  return {
    routeKey,
    requestContext: { authorizer: sub ? { jwt: { claims } } : undefined },
    queryStringParameters: query,
    pathParameters,
  };
}
const parse = (res) => JSON.parse(res.body);

function fakeDirectory(accounts = []) {
  const calls = [];
  return {
    calls,
    async search(q, opts) {
      calls.push({ q, opts });
      return accounts.filter((a) => (q.kind === 'sub' ? a.userId === q.term : a.email.startsWith(q.term)));
    },
    async list(opts) {
      calls.push({ list: opts });
      const start = opts.cursor ? Number(opts.cursor.slice(1)) : 0;
      const next = start + opts.limit;
      return { accounts: accounts.slice(start, next), cursor: next < accounts.length ? `p${next}` : null };
    },
    async get(userId) {
      return accounts.find((a) => a.userId === userId) ?? null;
    },
  };
}

function setup({ repo = new InMemoryRepo(), accounts = [], logs = [], mfa = async () => true } = {}) {
  const directory = fakeDirectory(accounts);
  const h = makeAdminHandlers({ repo, directory, mfa, now, log: (...args) => logs.push(args.join(' ')) });
  return { ...h, repo, directory, logs };
}

// --- acesso ---

test('toda rota do painel responde 403 para quem nao e admin', async () => {
  const { adminRouter, routeKeys } = setup();
  assert.equal(routeKeys.length, 9);
  for (const routeKey of routeKeys) {
    for (const groups of [null, '[]', '[editores]', 'administradores', '["editores"]']) {
      const res = await adminRouter(event({
        routeKey, groups, query: { q: 'ana' }, pathParameters: { userId: PERSON },
      }));
      assert.equal(res.statusCode, 403, `${routeKey} com grupos ${groups}`);
      assert.equal(parse(res).error.code, 'ADMIN_ONLY');
    }
  }
});

test('sem token: 401 (antes de olhar o grupo)', async () => {
  const { adminRouter } = setup();
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/overview', sub: null }));
  assert.equal(res.statusCode, 401);
});

test('o grupo vem em qualquer formato que o autorizador repasse', () => {
  assert.deepEqual(groupsOf({ 'cognito:groups': '[admin]' }), ['admin']);
  assert.deepEqual(groupsOf({ 'cognito:groups': '[editores admin]' }), ['editores', 'admin']);
  assert.deepEqual(groupsOf({ 'cognito:groups': ['admin'] }), ['admin']);
  assert.deepEqual(groupsOf({ 'cognito:groups': '["admin","editores"]' }), ['admin', 'editores']);
  assert.deepEqual(groupsOf({ 'cognito:groups': 'admin,editores' }), ['admin', 'editores']);
  assert.deepEqual(groupsOf({}), []);
  assert.equal(isAdmin({ 'cognito:groups': '[administrador]' }), false);
});

test('GET /v1/admin/me devolve quem esta logado e registra o acesso', async () => {
  const { adminRouter, logs } = setup();
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/me' }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res), { userId: ADMIN, email: 'dono@librax.example', groups: ['admin'] });
  assert.match(logs[0], new RegExp(ADMIN));
});

test('rota desconhecida no roteador: 404', async () => {
  const { adminRouter } = setup();
  assert.equal((await adminRouter(event({ routeKey: 'DELETE /v1/admin/accounts/{userId}' }))).statusCode, 404);
});

// --- operacao ---

test('GET /v1/admin/overview le os contadores agregados com os nomes das licoes', async () => {
  const repo = new InMemoryRepo();
  await recordLessonCompleted(repo, {
    userId: PERSON, lessonId: 'u1-l1', today: '2026-10-23',
    reviewed: [{ signId: 'letra-A', result: { state: 'failed' } }],
  });
  const { adminRouter } = setup({ repo });
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/overview' }));
  assert.equal(res.statusCode, 200);
  const body = parse(res);
  assert.equal(body.today, '2026-10-23');
  assert.equal(body.totals.activeToday, 1);
  assert.equal(body.lessons[0].lessonId, 'u1-l1');
  assert.equal(body.lessons[0].unitId, 'u1');
  assert.equal(typeof body.lessons[0].title, 'string');
  assert.deepEqual(body.signs, [{ signId: 'letra-A', gloss: 'A', failed: 1 }]);
});

test('GET /v1/admin/overview traz a camera de todas as pessoas com glosa e tipo do curso', async () => {
  const repo = new InMemoryRepo();
  await recordLessonCompleted(repo, {
    userId: PERSON, lessonId: 'u1-l1', today: '2026-10-23',
    cameraStats: { 'letra-K': { successes: 1, skips: 1, attempts: 4, wrong: { H: 3 } } },
  });
  const { adminRouter } = setup({ repo });
  const body = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/overview' })));
  assert.equal(body.camera.signs.length, 1);
  const { signId, gloss, kind, skipRate, avgAttempts, topWrong } = body.camera.signs[0];
  assert.deepEqual(
    { signId, gloss, kind, skipRate, avgAttempts, topWrong },
    { signId: 'letra-K', gloss: 'K', kind: 'letter', skipRate: 0.5, avgAttempts: 4, topWrong: [{ label: 'H', count: 3 }] },
  );
  // so totais: nenhum id de pessoa na resposta
  assert.equal(JSON.stringify(body.camera).includes(PERSON), false);
});

test('a tela de operacao nao faz Scan: so Querys na particao OPS', async () => {
  const repo = new InMemoryRepo();
  const used = [];
  for (const m of ['listOpsRange', 'listOpsLatest']) {
    const orig = repo[m].bind(repo);
    repo[m] = (...args) => {
      used.push([m, ...args]);
      return orig(...args);
    };
  }
  const { adminRouter } = setup({ repo });
  await adminRouter(event({ routeKey: 'GET /v1/admin/overview' }));
  assert.deepEqual(used, [
    ['listOpsRange', 'DAY#2026-09-24', 'DAY#2026-10-23#~'],
    ['listOpsLatest', 'WEEK#', 12],
    ['listOpsLatest', 'MONTH#', 12],
  ]);
});

// --- conteudo ---

test('GET /v1/admin/content: 14 unidades e 255 sinais com o que falta', async () => {
  const { adminRouter } = setup();
  const body = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/content' })));
  assert.equal(body.units.length, 14);
  assert.equal(body.signs.length, 255);
  const a = body.signs.find((s) => s.id === 'letra-A');
  assert.equal(a.validated, false);
  assert.ok(a.missing.includes('validated'));
  assert.equal(typeof a.hasAvatar, 'boolean');
});

// --- contas ---

const ana = { userId: PERSON, email: 'ana@exemplo.com', provider: 'Google', status: 'EXTERNAL_PROVIDER', enabled: true };

test('busca de conta por e-mail ou sub, com validacao do termo', async () => {
  const { adminRouter, directory, logs } = setup({ accounts: [ana] });
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: { q: ' Ana@' } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(parse(res).accounts, [ana]);
  assert.deepEqual(directory.calls[0].q, { kind: 'email', term: 'ana@' });
  assert.ok(logs.every((l) => !l.includes('ana@')), 'o termo buscado nao vai para o log');

  await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: { q: PERSON } }));
  assert.deepEqual(directory.calls[1].q, { kind: 'sub', term: PERSON });

  for (const q of ['ab', 'x'.repeat(200)]) {
    const r = await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: q === undefined ? {} : { q } }));
    assert.equal(r.statusCode, 400);
  }
  assert.deepEqual(parseAccountQuery('"ana"\\').value, { kind: 'email', term: 'ana' });
});

test('sem termo: lista todas as contas em paginas, so pelo Cognito', async () => {
  const contas = Array.from({ length: 30 }, (_, i) => ({ ...ana, userId: `id-${i}`, email: `c${i}@exemplo.com` }));
  const { adminRouter, directory, logs } = setup({ accounts: contas });

  const r1 = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: {} })));
  assert.equal(r1.accounts.length, 25);
  assert.equal(typeof r1.cursor, 'string');
  assert.deepEqual(directory.calls[0], { list: { limit: 25, cursor: null } });

  const r2 = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: { q: '  ', cursor: r1.cursor } })));
  assert.equal(r2.accounts.length, 5);
  assert.equal(r2.cursor, null);
  assert.deepEqual(directory.calls[1], { list: { limit: 25, cursor: 'p25' } });
  assert.ok(logs.some((l) => l.includes('accounts.list')));

  const r3 = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query: { limit: '10' } })));
  assert.equal(r3.accounts.length, 10);

  for (const query of [{ limit: '0' }, { limit: '51' }, { limit: 'x' }, { cursor: '%%%' }, { cursor: Buffer.from('{"a":1}').toString('base64url') }]) {
    assert.equal((await adminRouter(event({ routeKey: 'GET /v1/admin/accounts', query }))).statusCode, 400, JSON.stringify(query));
  }
});

test('resumo da conta: perfil, progresso, liga, squads e atividade', async () => {
  const repo = new InMemoryRepo();
  await repo.seedProfile({ userId: PERSON, xpTotal: 40, streak: 3, lessonsCompleted: 2 });
  await repo.saveProgress(PERSON, 'u1-l1', { status: 'completed', bestScore: 0.9, completedAt: '2026-10-22' });
  await repo.saveSrsItem(PERSON, 'letra-A', { ef: 2.5, reps: 1, interval: 1, dueAt: '2026-10-23' });
  await repo.addAchievement(PERSON, 'PRIMEIRA_LICAO');
  await repo.joinLeague({ leagueId: 'prata-2026-w43', tier: 'prata', period: '2026-w43', periodStart: 1792368000000 }, PERSON);
  await repo.incrementLeagueXp('prata-2026-w43', PERSON, 30);
  const squad = await createSquad(repo, {
    userId: PERSON, isGuest: false, name: 'Coda', type: 'private', genId: () => 's1', rng: () => 0.5, now: '2026-10-20T10:00:00.000Z',
  });
  await repo.markActivity(PERSON, { day: '2026-10-23', week: '2026-w43', month: '2026-10' });

  const { adminRouter } = setup({ repo, accounts: [ana] });
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/accounts/{userId}', pathParameters: { userId: PERSON } }));
  assert.equal(res.statusCode, 200);
  const s = parse(res);
  assert.equal(s.account.email, 'ana@exemplo.com');
  assert.equal(s.profile.xpTotal, 40);
  assert.equal(s.progress.distinctLessons, 1);
  assert.equal(s.progress.totalLessons, 57);
  assert.equal(s.progress.lessons[0].unitId, 'u1');
  assert.deepEqual(s.srs, { signs: 1, due: 1 });
  assert.deepEqual(s.achievements, ['PRIMEIRA_LICAO']);
  assert.deepEqual(s.league.current, { leagueId: 'prata-2026-w43', period: '2026-w43', xpPeriod: 30 });
  assert.deepEqual(s.squads, [{ squadId: squad.squadId, name: 'Coda', type: 'private', memberCount: 1, role: 'admin', xpWeeklyContrib: 0 }]);
  assert.equal(s.activity.lastDay, '2026-10-23');
  // so leitura: nenhum campo de convite nem token
  assert.equal(JSON.stringify(s).includes(squad.inviteCode), false);
});

test('resumo da conta: id invalido 400, conta inexistente 404', async () => {
  const { adminRouter } = setup();
  const get = (userId) => adminRouter(event({ routeKey: 'GET /v1/admin/accounts/{userId}', pathParameters: { userId } }));
  assert.equal((await get('u1')).statusCode, 400);
  assert.equal((await get(PERSON)).statusCode, 404);
});

// --- squads ---

test('lista de squads da mais nova para a mais velha, com pagina', async () => {
  const repo = new InMemoryRepo();
  for (const [i, day] of ['2026-10-01', '2026-10-05', '2026-10-09'].entries()) {
    await createSquad(repo, {
      userId: `dono-${i}`, isGuest: false, name: `Squad ${i}`, type: 'public', genId: () => `s${i}`, rng: () => 0.1 * (i + 1), now: `${day}T12:00:00.000Z`,
    });
  }
  const { adminRouter } = setup({ repo });
  const p1 = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/squads', query: { limit: '2' } })));
  assert.deepEqual(p1.squads.map((s) => s.name), ['Squad 2', 'Squad 1']);
  assert.equal(p1.squads[0].memberCount, 1);
  assert.equal(p1.squads[0].createdAt, '2026-10-09T12:00:00.000Z');
  assert.equal(typeof p1.cursor, 'string');

  const p2 = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/squads', query: { limit: '2', cursor: p1.cursor } })));
  assert.deepEqual(p2.squads.map((s) => s.name), ['Squad 0']);
  assert.equal(p2.cursor, null);

  const bad = (query) => adminRouter(event({ routeKey: 'GET /v1/admin/squads', query }));
  assert.equal((await bad({ limit: '0' })).statusCode, 400);
  assert.equal((await bad({ cursor: '%%%' })).statusCode, 400);
  assert.equal((await bad({ cursor: encodeCursor({ PK: 'USER#x', SK: 'PROFILE' }) })).statusCode, 400);
});

// --- custo ---

test('GET /v1/admin/cost devolve o ultimo mes guardado e o historico', async () => {
  const repo = new InMemoryRepo();
  await repo.setOpsFields('COST#2026-09', { month: '2026-09', total: 3.2, projectedTotal: 3.2, complete: true, byService: [] });
  await repo.setOpsFields('COST#2026-10', {
    month: '2026-10', total: 1.5, projectedTotal: 2.1, complete: false,
    byService: [{ service: 'Amazon DynamoDB', amount: 1 }, { service: 'AWS Lambda', amount: 0.5 }],
  });
  const { adminRouter } = setup({ repo });
  const body = parse(await adminRouter(event({ routeKey: 'GET /v1/admin/cost' })));
  assert.equal(body.latest.month, '2026-10');
  assert.equal(body.latest.byService.length, 2);
  assert.deepEqual(body.months.map((m) => m.month), ['2026-10', '2026-09']);
  assert.equal(body.months[0].byService, undefined);
});

test('GET /v1/admin/cost antes do primeiro job: latest null', async () => {
  const { adminRouter } = setup();
  assert.deepEqual(parse(await adminRouter(event({ routeKey: 'GET /v1/admin/cost' }))), { latest: null, months: [] });
});

// --- diretorio do Cognito ---

test('CognitoDirectory filtra por comeco do e-mail ou por sub e nao devolve atributos sensiveis', async () => {
  const calls = [];
  const client = {
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      return {
        Users: [{
          Username: 'google_123',
          UserStatus: 'EXTERNAL_PROVIDER',
          Enabled: true,
          UserCreateDate: new Date('2026-10-01T10:00:00Z'),
          Attributes: [
            { Name: 'sub', Value: PERSON },
            { Name: 'email', Value: 'ana@exemplo.com' },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'identities', Value: '[{"providerName":"Google","userId":"123"}]' },
          ],
        }],
      };
    },
  };
  const dir = new CognitoDirectory(client, 'us-east-1_pool');
  const [acc] = await dir.search({ kind: 'email', term: 'ana' });
  assert.equal(calls[0].name, 'ListUsersCommand');
  assert.deepEqual(calls[0].input, { UserPoolId: 'us-east-1_pool', Filter: 'email ^= "ana"', Limit: 10 });
  assert.deepEqual(acc, {
    userId: PERSON, email: 'ana@exemplo.com', emailVerified: true, name: null, provider: 'Google',
    status: 'EXTERNAL_PROVIDER', enabled: true, createdAt: '2026-10-01T10:00:00.000Z',
  });
  await dir.get(PERSON);
  assert.equal(calls[1].input.Filter, `sub = "${PERSON}"`);
  const page = await dir.list({ limit: 25, cursor: 'tok' });
  assert.deepEqual(calls[2].input, { UserPoolId: 'us-east-1_pool', Limit: 25, PaginationToken: 'tok' });
  assert.equal(page.accounts.length, 1);
  assert.equal(page.cursor, null);
  await dir.list();
  assert.deepEqual(calls[3].input, { UserPoolId: 'us-east-1_pool', Limit: 25 });
  assert.equal(accountFromCognito({ Attributes: [] }).provider, 'email');
});

test('CognitoDirectory.deleteUser apaga pelo username (Google tambem); ja apagado conta como feito', async () => {
  const calls = [];
  let gone = false;
  const client = {
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      if (gone) throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
      gone = true;
      return {};
    },
  };
  const dir = new CognitoDirectory(client, 'us-east-1_pool');
  assert.equal(await dir.deleteUser('google_123'), true);
  assert.equal(calls[0].name, 'AdminDeleteUserCommand');
  assert.deepEqual(calls[0].input, { UserPoolId: 'us-east-1_pool', Username: 'google_123' });
  assert.equal(await dir.deleteUser('google_123'), false);

  const down = new CognitoDirectory({ send: async () => { throw Object.assign(new Error('x'), { name: 'InternalErrorException' }); } }, 'p');
  await assert.rejects(() => down.deleteUser('u1'), /x/);
});

// --- segundo fator (aplicativo autenticador) ---

test('admin sem o autenticador ligado: 403 ADMIN_MFA_REQUIRED em toda rota, e a conferencia usa o cognito:username', async () => {
  const asked = [];
  const { adminRouter, routeKeys, logs } = setup({ mfa: async (username) => { asked.push(username); return false; } });
  for (const routeKey of routeKeys) {
    const res = await adminRouter(event({
      routeKey, query: { q: 'ana' }, pathParameters: { userId: PERSON }, extraClaims: { 'cognito:username': 'nome-de-usuario' },
    }));
    assert.equal(res.statusCode, 403, routeKey);
    assert.equal(parse(res).error.code, 'ADMIN_MFA_REQUIRED');
  }
  assert.ok(asked.every((u) => u === 'nome-de-usuario'));
  assert.ok(logs.every((l) => l.includes('"denied":"mfa"')));
  // sem cognito:username no token: o sub
  await adminRouter(event({ routeKey: 'GET /v1/admin/me' }));
  assert.equal(asked.at(-1), ADMIN);
});

test('quem nao e admin nem chega a conferir o autenticador (403 ADMIN_ONLY)', async () => {
  let calls = 0;
  const { adminRouter } = setup({ mfa: async () => { calls += 1; return true; } });
  const res = await adminRouter(event({ routeKey: 'GET /v1/admin/me', groups: '[]' }));
  assert.equal(parse(res).error.code, 'ADMIN_ONLY');
  assert.equal(calls, 0);
});

test('conta do Google no grupo admin: 403 ADMIN_MFA_FEDERATED (o fator do Cognito nao vale para ela)', async () => {
  const { adminRouter } = setup({ mfa: async () => true });
  const res = await adminRouter(event({
    routeKey: 'GET /v1/admin/me',
    extraClaims: { identities: '[{"providerName":"Google","userId":"123"}]', 'cognito:username': 'google_123' },
  }));
  assert.equal(res.statusCode, 403);
  assert.equal(parse(res).error.code, 'ADMIN_MFA_FEDERATED');
  assert.equal(isFederated({}), false);
  assert.equal(isFederated({ identities: '[]' }), false);
});

test('falha ao ler a conta no Cognito: 500 (nunca abre o painel sem conferir)', async () => {
  const { adminRouter } = setup({ mfa: async () => { throw new Error('cognito fora'); } });
  const original = console.error;
  console.error = () => {};
  try {
    assert.equal((await adminRouter(event({ routeKey: 'GET /v1/admin/me' }))).statusCode, 500);
  } finally {
    console.error = original;
  }
});

test('mfa e obrigatorio na fabrica: so `false` desliga (ambiente local)', () => {
  assert.throws(() => makeAdminHandlers({ repo: new InMemoryRepo(), directory: fakeDirectory() }), /mfa/);
  const { adminRouter } = makeAdminHandlers({ repo: new InMemoryRepo(), directory: fakeDirectory(), mfa: false, now, log: () => {} });
  return adminRouter(event({ routeKey: 'GET /v1/admin/me' })).then((res) => assert.equal(res.statusCode, 200));
});

test('makeMfaGate guarda so o "sim", por alguns minutos; o "nao" e conferido de novo na hora', async () => {
  let t = 0;
  let enabled = false;
  let reads = 0;
  const gate = makeMfaGate(async () => { reads += 1; return enabled; }, { now: () => t });
  assert.equal(await gate('u'), false);
  enabled = true;
  assert.equal(await gate('u'), true); // logo depois de configurar: abre
  assert.equal(reads, 2);
  enabled = false;
  t += MFA_CACHE_MS - 1;
  assert.equal(await gate('u'), true); // guardado
  assert.equal(reads, 2);
  t += 2;
  assert.equal(await gate('u'), false); // venceu: le de novo
  assert.equal(reads, 3);
});

test('CognitoDirectory.totpEnabled le o UserMFASettingList pelo AdminGetUser', async () => {
  const calls = [];
  const users = {
    'com-app': { UserMFASettingList: ['SOFTWARE_TOKEN_MFA'], PreferredMfaSetting: 'SOFTWARE_TOKEN_MFA' },
    'sem-nada': {},
  };
  const client = {
    async send(cmd) {
      calls.push({ name: cmd.constructor.name, input: cmd.input });
      const u = users[cmd.input.Username];
      if (!u) throw Object.assign(new Error('User does not exist.'), { name: 'UserNotFoundException' });
      return u;
    },
  };
  const dir = new CognitoDirectory(client, 'us-east-1_pool');
  assert.equal(await dir.totpEnabled('com-app'), true);
  assert.equal(await dir.totpEnabled('sem-nada'), false);
  assert.equal(await dir.totpEnabled('nao-existe'), false);
  assert.equal(calls[0].name, 'AdminGetUserCommand');
  assert.deepEqual(calls[0].input, { UserPoolId: 'us-east-1_pool', Username: 'com-app' });
  const down = new CognitoDirectory({ send: async () => { throw Object.assign(new Error('x'), { name: 'InternalErrorException' }); } }, 'p');
  await assert.rejects(() => down.totpEnabled('u1'), /x/);
});
