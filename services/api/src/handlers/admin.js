/**
 * Handlers do painel de administracao (docs/painel-admin.md). Todas as rotas so leem.
 *
 * GET /v1/admin/me                    quem esta logado (o site usa para decidir se abre)
 * GET /v1/admin/overview?days=7|30|90  operacao: ativos, contas novas, licoes, erros, desistencias e
 *                                     lembretes, com o mesmo periodo anterior para comparar
 * GET /v1/admin/content               unidades e sinais: validado, fonte, video, avatar, o que falta
 * GET /v1/admin/accounts?q=<termo>    busca por e-mail (comeco) ou sub
 * GET /v1/admin/accounts?cursor=&limit=  sem `q`: todas as contas, uma pagina por vez (so Cognito)
 * GET /v1/admin/accounts?group=admin  so quem e admin (o dono marcado), uma pagina por vez
 * GET /v1/admin/accounts/{userId}     resumo da conta: perfil, progresso, liga e squads
 * GET /v1/admin/squads?cursor=&limit= squads da mais nova para a mais velha
 * GET /v1/admin/cost                  custo do mes (guardado uma vez por dia pelo job opsDaily)
 * GET /v1/admin/usage                 uso anonimo: ativos, retencao, funil, licoes e notas (TELAGG)
 * GET /v1/admin/feedback?rating=&cursor=&limit=  notas do app, da mais nova para a mais velha
 *
 * Acoes sobre uma conta (outra Lambda, `adminActionsRouter`, a unica do painel que escreve):
 * POST   /v1/admin/accounts/{userId}/disable  desativa o login e encerra as sessoes
 * POST   /v1/admin/accounts/{userId}/enable   reativa
 * DELETE /v1/admin/accounts/{userId}          exclui a conta e os dados (pedido pela LGPD), com o
 *                                             e-mail da conta no corpo como confirmacao
 * POST   /v1/admin/accounts/{userId}/admin    torna admin (so o dono; conta de e-mail e senha
 *                                             confirmada; e-mail da conta no corpo como confirmacao)
 * DELETE /v1/admin/accounts/{userId}/admin    tira do admin e encerra as sessoes (so o dono)
 * Nunca na propria conta de quem esta no painel, nunca na conta do dono (grupo `owner`, so pelo
 * script), e conta de outro admin so o dono mexe. Cada acao vai para o log com quem fez, o que fez e
 * o id da conta (sem e-mail).
 *
 * Tres travas: o autorizador JWT so aceita o id token do app client do painel, cada handler
 * confere o grupo `admin` no token (`requireAdmin`, 403 para os outros) e a conta precisa ter o
 * aplicativo autenticador ligado (403 ADMIN_MFA_REQUIRED, que o painel usa para guiar a
 * configuracao; conta federada: 403 ADMIN_MFA_FEDERATED). O Cognito nao exige MFA por grupo nem diz
 * no token como a pessoa entrou, entao a Lambda le a conta (AdminGetUser, domain/admin.js,
 * makeMfaGate): com o autenticador ligado, todo login dela pede o codigo. Cada acesso vai para o
 * log com o sub de quem consultou (trilha para a LGPD), sem o termo buscado. Alem do token, o grupo
 * e conferido na conta agora (`liveGroups`, domain/admin.js makeGroupsGate): quem sai do admin perde o
 * painel em ate 1 minuto, sem esperar o token vencer.
 *
 * Em producao as rotas sao servidas por uma Lambda so (`adminRouter`, pelo `routeKey`): o painel
 * e pouco usado, entao uma funcao quente atende todas as abas, e a permissao de leitura do Cognito
 * fica numa funcao so. `makeAdminHandlers({ repo, directory, mfa, content, now })` recebe as
 * dependencias (testes usam InMemoryRepo e um diretorio falso). `mfa` e a conferencia do
 * autenticador (`(username) => Promise<boolean>`) ou `false` so no ambiente local, cujo login
 * hospedado nao tem o desafio do codigo. `liveGroups` e a leitura dos grupos de agora
 * (makeGroupsGate) ou `false`, que usa so os do token (testes).
 */

import { opsOverview, accountSummary, listSquads, costView } from '../usecases/admin.js';
import { deleteAccount } from '../usecases/deleteAccount.js';
import { usageOverview, feedbackPage } from '../usecases/telemetry.js';
import {
  isUserId, parseAccountQuery, groupsOf, isFederated, makeMfaGate, makeGroupsGate, ADMIN_GROUP, OWNER_GROUP,
} from '../domain/admin.js';
import { labelsFromReport } from '../content/contentReport.js';
import { OVERVIEW_DAYS, OVERVIEW_PERIODS } from '../domain/opsMetrics.js';
import contentStatus from '../content/contentStatus.js';
import { claims, ok, fail, ApiError, wrap, requireAdmin, body } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { CognitoDirectory, makeCognitoClient } from '../adapters/cognitoDirectory.js';

const MAX_PAGE = 50;
/** Contas por pagina na listagem (o ListUsers aceita ate 60). */
const ACCOUNTS_PAGE = 25;

/** Cursor de pagina opaco para o cliente: o LastEvaluatedKey em base64url. */
export const encodeCursor = (cursor) => (cursor == null ? null : Buffer.from(JSON.stringify(cursor)).toString('base64url'));
export function decodeCursor(raw) {
  if (raw == null || raw === '') return null;
  try {
    return JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
  } catch {
    throw new ApiError(400, 'BAD_CURSOR', 'cursor invalido');
  }
}

export function makeAdminHandlers({
  repo, directory, mfa, liveGroups, content = contentStatus, now = () => new Date(), log = console.log, budgetUsd = null,
}) {
  if (mfa !== false && typeof mfa !== 'function') {
    throw new Error('makeAdminHandlers: passe `mfa` (conferencia do autenticador) ou `false` (so no ambiente local)');
  }
  if (liveGroups !== false && typeof liveGroups?.get !== 'function') {
    throw new Error('makeAdminHandlers: passe `liveGroups` (grupos de agora, makeGroupsGate) ou `false` (so os do token)');
  }
  const labels = labelsFromReport(content);
  const totalLessons = content.totals?.lessons ?? null;
  const query = (event) => event.queryStringParameters ?? {};

  /** Segundo fator: a conta de quem chama precisa ter o aplicativo autenticador ligado. */
  async function requireAdminMfa(event, adminId, route) {
    if (mfa === false) return;
    const c = claims(event);
    if (isFederated(c)) {
      log('[admin]', JSON.stringify({ adminId, route, denied: 'mfa-federated' }));
      throw new ApiError(403, 'ADMIN_MFA_FEDERATED', 'O painel exige o aplicativo autenticador, que contas do Google ou da Apple nao tem aqui. Entre com uma conta de e-mail e senha.');
    }
    if (!(await mfa(String(c['cognito:username'] ?? adminId)))) {
      log('[admin]', JSON.stringify({ adminId, route, denied: 'mfa' }));
      throw new ApiError(403, 'ADMIN_MFA_REQUIRED', 'Configure o aplicativo autenticador para abrir o painel.');
    }
  }

  /** Grupos de agora de quem chama (os do token so quando `liveGroups` e false). */
  async function currentGroups(event, adminId) {
    if (liveGroups === false) return groupsOf(claims(event));
    return liveGroups.get(String(claims(event)['cognito:username'] ?? adminId));
  }

  /** Envelope comum: confere o grupo e o segundo fator, registra o acesso e serializa. */
  const admin = (route, fn) =>
    wrap(async (event) => {
      const adminId = requireAdmin(event);
      await requireAdminMfa(event, adminId, route);
      const groups = await currentGroups(event, adminId);
      if (!groups.includes(ADMIN_GROUP)) {
        log('[admin]', JSON.stringify({ adminId, route, denied: 'group' }));
        throw new ApiError(403, 'ADMIN_ONLY', 'Acesso restrito ao grupo admin');
      }
      log('[admin]', JSON.stringify({ adminId, route }));
      return ok(await fn(event, adminId, groups));
    });

  const adminMeHandler = admin('me', async (event, adminId, groups) => ({
    userId: adminId,
    email: claims(event).email ?? null,
    groups,
  }));

  const adminOverviewHandler = admin('overview', (event) => {
    const raw = query(event).days;
    const days = raw === undefined ? OVERVIEW_DAYS : Number(raw);
    if (!OVERVIEW_PERIODS.includes(days)) throw new ApiError(400, 'BAD_DAYS', `days deve ser ${OVERVIEW_PERIODS.join(', ')}`);
    return opsOverview(repo, { now: now(), labels, days });
  });

  const adminContentHandler = admin('content', () => content);

  const searchAccounts = admin('accounts.search', async (event) => {
    const parsed = parseAccountQuery(query(event).q);
    if (!parsed.ok) throw new ApiError(400, parsed.error, 'Busque por pelo menos 3 letras do e-mail ou pelo id');
    return { accounts: await directory.search(parsed.value, { limit: 10 }) };
  });

  // Sem termo: a lista inteira em paginas. Le so o Cognito (nada da tabela por conta), uma chamada
  // do ListUsers por pagina.
  const listAccounts = admin('accounts.list', async (event) => {
    const q = query(event);
    const limit = q.limit === undefined ? ACCOUNTS_PAGE : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new ApiError(400, 'BAD_LIMIT', `limit entre 1 e ${MAX_PAGE}`);
    }
    const cursor = decodeCursor(q.cursor);
    if (cursor !== null && (typeof cursor !== 'string' || cursor.length > 4096)) {
      throw new ApiError(400, 'BAD_CURSOR', 'cursor invalido');
    }
    if (q.group === undefined || q.group === '') {
      const page = await directory.list({ limit, cursor });
      return { accounts: page.accounts, cursor: encodeCursor(page.cursor) };
    }
    // So admins: a pagina do grupo, com o dono marcado (o grupo do dono tem uma ou duas contas)
    if (q.group !== ADMIN_GROUP) throw new ApiError(400, 'BAD_GROUP', `group so aceita ${ADMIN_GROUP}`);
    const [page, owners] = await Promise.all([
      directory.listGroup(ADMIN_GROUP, { limit, cursor }),
      directory.listGroup(OWNER_GROUP, { limit: 60 }),
    ]);
    const ownerIds = new Set(owners.accounts.map((a) => a.userId));
    return {
      accounts: page.accounts.map((a) => ({ ...a, groups: ownerIds.has(a.userId) ? [ADMIN_GROUP, OWNER_GROUP] : [ADMIN_GROUP] })),
      cursor: encodeCursor(page.cursor),
    };
  });

  const adminSearchAccountsHandler = (event) => {
    const term = query(event).q;
    return typeof term === 'string' && term.trim() !== '' ? searchAccounts(event) : listAccounts(event);
  };

  const adminAccountHandler = admin('accounts.get', async (event) => {
    const uid = event.pathParameters?.userId;
    if (!isUserId(uid)) throw new ApiError(400, 'BAD_USER_ID', 'userId deve ser o sub do Cognito');
    const summary = await accountSummary(repo, directory, { userId: uid, labels, totalLessons, now: now() });
    if (!summary) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Conta nao encontrada');
    // Acesso ao painel: os grupos de agora da conta (admin, owner)
    if (!summary.account?.username) return summary;
    return { ...summary, account: { ...summary.account, groups: await directory.groupsFor(summary.account.username) } };
  });

  const adminSquadsHandler = admin('squads', async (event) => {
    const q = query(event);
    const limit = q.limit === undefined ? 25 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new ApiError(400, 'BAD_LIMIT', `limit entre 1 e ${MAX_PAGE}`);
    }
    const cursor = decodeCursor(q.cursor);
    // so pagina do registro de squads (o InMemoryRepo usa a posicao)
    if (cursor !== null && typeof cursor !== 'number' && !(cursor?.PK === 'SQUADINDEX' && typeof cursor.SK === 'string')) {
      throw new ApiError(400, 'BAD_CURSOR', 'cursor invalido');
    }
    const page = await listSquads(repo, { limit, cursor, now: now() });
    return { squads: page.squads, cursor: encodeCursor(page.cursor) };
  });

  const adminCostHandler = admin('cost', () => costView(repo, { budgetUsd }));

  const adminUsageHandler = admin('usage', () => usageOverview(repo, { now: now(), labels }));

  const adminFeedbackHandler = admin('feedback', async (event) => {
    const q = query(event);
    const limit = q.limit === undefined ? 20 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
      throw new ApiError(400, 'BAD_LIMIT', `limit entre 1 e ${MAX_PAGE}`);
    }
    const rating = q.rating === undefined || q.rating === '' ? null : Number(q.rating);
    if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
      throw new ApiError(400, 'BAD_RATING', 'rating entre 1 e 5');
    }
    const cursor = decodeCursor(q.cursor);
    // so a SK de uma entrada da lista (ISO + sufixo)
    if (cursor !== null && !(typeof cursor === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z#[0-9a-f]{1,32}$/.test(cursor))) {
      throw new ApiError(400, 'BAD_CURSOR', 'cursor invalido');
    }
    const page = await feedbackPage(repo, { rating, limit, cursor });
    return { items: page.items, cursor: encodeCursor(page.cursor) };
  });

  const routes = {
    'GET /v1/admin/me': adminMeHandler,
    'GET /v1/admin/overview': adminOverviewHandler,
    'GET /v1/admin/content': adminContentHandler,
    'GET /v1/admin/accounts': adminSearchAccountsHandler,
    'GET /v1/admin/accounts/{userId}': adminAccountHandler,
    'GET /v1/admin/squads': adminSquadsHandler,
    'GET /v1/admin/cost': adminCostHandler,
    'GET /v1/admin/usage': adminUsageHandler,
    'GET /v1/admin/feedback': adminFeedbackHandler,
  };

  // --- acoes sobre uma conta (Lambda librax-admin-actions) ---

  /**
   * A conta da acao, com os grupos dela. A do dono nao muda pelo painel, e a de outro admin so o
   * dono mexe (um admin nao desativa nem exclui outro).
   */
  async function targetAccount(event, adminId, callerGroups) {
    const uid = event.pathParameters?.userId;
    if (!isUserId(uid)) throw new ApiError(400, 'BAD_USER_ID', 'userId deve ser o sub do Cognito');
    if (uid === adminId) throw new ApiError(400, 'SELF', 'Nao da para agir na propria conta pelo painel');
    const account = await directory.get(uid);
    if (!account?.username) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Conta nao encontrada');
    const groups = await directory.groupsFor(account.username);
    if (groups.includes(OWNER_GROUP)) {
      throw new ApiError(403, 'OWNER_PROTECTED', 'A conta do dono do painel so muda pelo script de lancamento');
    }
    if (groups.includes(ADMIN_GROUP) && !callerGroups.includes(OWNER_GROUP)) {
      throw new ApiError(403, 'OWNER_ONLY', 'So o dono do painel mexe na conta de outro admin');
    }
    return { ...account, groups };
  }
  function requireOwner(callerGroups) {
    if (!callerGroups.includes(OWNER_GROUP)) throw new ApiError(403, 'OWNER_ONLY', 'So o dono do painel muda quem e admin');
  }
  /** Confirmacao digitada no painel: o e-mail da conta (ou o id, se ela nao tiver e-mail). */
  function requireConfirm(event, account) {
    const confirm = String(body(event, { maxBytes: 1024 })?.confirm ?? '').trim().toLowerCase();
    if (confirm !== String(account.email ?? account.userId).toLowerCase()) {
      throw new ApiError(400, 'CONFIRM_MISMATCH', 'Digite o e-mail da conta para confirmar');
    }
  }
  const audit = (adminId, action, userId, extra = {}) =>
    log('[admin-acao]', JSON.stringify({ adminId, action, userId, ...extra }));

  const disableAccountHandler = admin('accounts.disable', async (event, adminId, groups) => {
    const account = await targetAccount(event, adminId, groups);
    await directory.disableUser(account.username);
    audit(adminId, 'disable', account.userId);
    return { ok: true, enabled: false };
  });

  const enableAccountHandler = admin('accounts.enable', async (event, adminId, groups) => {
    const account = await targetAccount(event, adminId, groups);
    await directory.enableUser(account.username);
    audit(adminId, 'enable', account.userId);
    return { ok: true, enabled: true };
  });

  const deleteAccountHandler = admin('accounts.delete', async (event, adminId, groups) => {
    const account = await targetAccount(event, adminId, groups);
    requireConfirm(event, account);
    const report = await deleteAccount(repo, { userId: account.userId, username: account.username, directory });
    audit(adminId, 'delete', account.userId, { report });
    return { ok: true };
  });

  // Quem e admin: so o dono muda. So conta de e-mail e senha, confirmada e ativa, vira admin (o painel
  // exige o aplicativo autenticador, que conta do Google nao tem aqui). A pessoa promovida entra de novo
  // no painel e configura o autenticador no primeiro acesso.
  const grantAdminHandler = admin('accounts.grantAdmin', async (event, adminId, groups) => {
    requireOwner(groups);
    const account = await targetAccount(event, adminId, groups);
    if (account.provider !== 'email') {
      throw new ApiError(400, 'ADMIN_NEEDS_PASSWORD', 'So conta de e-mail e senha vira admin: o painel exige o aplicativo autenticador');
    }
    if (!account.enabled) throw new ApiError(400, 'ACCOUNT_DISABLED', 'Reative a conta antes de tornar admin');
    if (account.status !== 'CONFIRMED') throw new ApiError(400, 'ACCOUNT_NOT_CONFIRMED', 'A conta ainda nao confirmou o e-mail');
    requireConfirm(event, account);
    await directory.addToGroup(account.username, ADMIN_GROUP);
    audit(adminId, 'admin.grant', account.userId);
    return { ok: true, groups: [...new Set([...account.groups, ADMIN_GROUP])] };
  });

  // Tirar do admin encerra as sessoes da pessoa; o painel aberto dela para em ate 1 minuto (liveGroups)
  const revokeAdminHandler = admin('accounts.revokeAdmin', async (event, adminId, groups) => {
    requireOwner(groups);
    const account = await targetAccount(event, adminId, groups);
    if (account.groups.includes(ADMIN_GROUP)) {
      await directory.removeFromGroup(account.username, ADMIN_GROUP);
      if (liveGroups !== false) liveGroups.forget(account.username);
    }
    audit(adminId, 'admin.revoke', account.userId);
    return { ok: true, groups: account.groups.filter((g) => g !== ADMIN_GROUP) };
  });

  const actionRoutes = {
    'POST /v1/admin/accounts/{userId}/disable': disableAccountHandler,
    'POST /v1/admin/accounts/{userId}/enable': enableAccountHandler,
    'DELETE /v1/admin/accounts/{userId}': deleteAccountHandler,
    'POST /v1/admin/accounts/{userId}/admin': grantAdminHandler,
    'DELETE /v1/admin/accounts/{userId}/admin': revokeAdminHandler,
  };

  /** A Lambda das acoes (com permissao de escrita), separada da de leitura. */
  async function adminActionsRouter(event) {
    const route = actionRoutes[event?.routeKey];
    if (!route) return fail('NOT_FOUND', 'Rota inexistente', 404);
    return route(event);
  }

  /** Uma Lambda para todas as rotas do painel (pelo `routeKey` do API Gateway). */
  async function adminRouter(event) {
    const route = routes[event?.routeKey];
    if (!route) return fail('NOT_FOUND', 'Rota inexistente', 404);
    return route(event);
  }

  return {
    adminMeHandler,
    adminOverviewHandler,
    adminContentHandler,
    adminSearchAccountsHandler,
    adminAccountHandler,
    adminSquadsHandler,
    adminCostHandler,
    adminUsageHandler,
    adminFeedbackHandler,
    adminRouter,
    routeKeys: Object.keys(routes),
    adminActionsRouter,
    actionRouteKeys: Object.keys(actionRoutes),
  };
}

const directory = new CognitoDirectory(makeCognitoClient(), process.env.USER_POOL_ID);

export const { adminRouter, adminActionsRouter } = makeAdminHandlers({
  repo: dynamoRepo,
  directory,
  mfa: makeMfaGate((username) => directory.totpEnabled(username)),
  liveGroups: makeGroupsGate((username) => directory.groupsFor(username)),
  budgetUsd: Number(process.env.MONTHLY_BUDGET_USD) > 0 ? Number(process.env.MONTHLY_BUDGET_USD) : null,
});
