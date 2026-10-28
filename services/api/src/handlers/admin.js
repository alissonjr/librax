/**
 * Handlers do painel de administracao (docs/painel-admin.md). Todas as rotas so leem.
 *
 * GET /v1/admin/me                    quem esta logado (o site usa para decidir se abre)
 * GET /v1/admin/overview              operacao: ativos, contas novas, licoes, erros e desistencias
 * GET /v1/admin/content               unidades e sinais: validado, fonte, video, avatar, o que falta
 * GET /v1/admin/accounts?q=<termo>    busca por e-mail (comeco) ou sub
 * GET /v1/admin/accounts?cursor=&limit=  sem `q`: todas as contas, uma pagina por vez (so Cognito)
 * GET /v1/admin/accounts/{userId}     resumo da conta: perfil, progresso, liga e squads
 * GET /v1/admin/squads?cursor=&limit= squads da mais nova para a mais velha
 * GET /v1/admin/cost                  custo do mes (guardado uma vez por dia pelo job opsDaily)
 * GET /v1/admin/usage                 uso anonimo: ativos, retencao, funil, licoes e notas (TELAGG)
 * GET /v1/admin/feedback?rating=&cursor=&limit=  notas do app, da mais nova para a mais velha
 *
 * Tres travas: o autorizador JWT so aceita o id token do app client do painel, cada handler
 * confere o grupo `admin` no token (`requireAdmin`, 403 para os outros) e a conta precisa ter o
 * aplicativo autenticador ligado (403 ADMIN_MFA_REQUIRED, que o painel usa para guiar a
 * configuracao; conta federada: 403 ADMIN_MFA_FEDERATED). O Cognito nao exige MFA por grupo nem diz
 * no token como a pessoa entrou, entao a Lambda le a conta (AdminGetUser, domain/admin.js,
 * makeMfaGate): com o autenticador ligado, todo login dela pede o codigo. Cada acesso vai para o
 * log com o sub de quem consultou (trilha para a LGPD), sem o termo buscado.
 *
 * Em producao as rotas sao servidas por uma Lambda so (`adminRouter`, pelo `routeKey`): o painel
 * e pouco usado, entao uma funcao quente atende todas as abas, e a permissao de leitura do Cognito
 * fica numa funcao so. `makeAdminHandlers({ repo, directory, mfa, content, now })` recebe as
 * dependencias (testes usam InMemoryRepo e um diretorio falso). `mfa` e a conferencia do
 * autenticador (`(username) => Promise<boolean>`) ou `false` so no ambiente local, cujo login
 * hospedado nao tem o desafio do codigo.
 */

import { opsOverview, accountSummary, listSquads, costView } from '../usecases/admin.js';
import { usageOverview, feedbackPage } from '../usecases/telemetry.js';
import { isUserId, parseAccountQuery, groupsOf, isFederated, makeMfaGate } from '../domain/admin.js';
import { labelsFromReport } from '../content/contentReport.js';
import contentStatus from '../content/contentStatus.js';
import { claims, ok, fail, ApiError, wrap, requireAdmin } from './_http.js';
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

export function makeAdminHandlers({ repo, directory, mfa, content = contentStatus, now = () => new Date(), log = console.log }) {
  if (mfa !== false && typeof mfa !== 'function') {
    throw new Error('makeAdminHandlers: passe `mfa` (conferencia do autenticador) ou `false` (so no ambiente local)');
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

  /** Envelope comum: confere o grupo e o segundo fator, registra o acesso e serializa. */
  const admin = (route, fn) =>
    wrap(async (event) => {
      const adminId = requireAdmin(event);
      await requireAdminMfa(event, adminId, route);
      log('[admin]', JSON.stringify({ adminId, route }));
      return ok(await fn(event, adminId));
    });

  const adminMeHandler = admin('me', async (event, adminId) => ({
    userId: adminId,
    email: claims(event).email ?? null,
    groups: groupsOf(claims(event)),
  }));

  const adminOverviewHandler = admin('overview', () => opsOverview(repo, { now: now(), labels }));

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
    const page = await directory.list({ limit, cursor });
    return { accounts: page.accounts, cursor: encodeCursor(page.cursor) };
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
    return summary;
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

  const adminCostHandler = admin('cost', () => costView(repo));

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
  };
}

const directory = new CognitoDirectory(makeCognitoClient(), process.env.USER_POOL_ID);

export const { adminRouter } = makeAdminHandlers({
  repo: dynamoRepo,
  directory,
  mfa: makeMfaGate((username) => directory.totpEnabled(username)),
});
