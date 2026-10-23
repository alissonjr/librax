/**
 * Handlers do painel de administracao (docs/painel-admin.md). Todas as rotas so leem.
 *
 * GET /v1/admin/me                    quem esta logado (o site usa para decidir se abre)
 * GET /v1/admin/overview              operacao: ativos, contas novas, licoes, erros e desistencias
 * GET /v1/admin/content               unidades e sinais: validado, fonte, video, avatar, o que falta
 * GET /v1/admin/accounts?q=<termo>    busca por e-mail (comeco) ou sub
 * GET /v1/admin/accounts/{userId}     resumo da conta: perfil, progresso, liga e squads
 * GET /v1/admin/squads?cursor=&limit= squads da mais nova para a mais velha
 * GET /v1/admin/cost                  custo do mes (guardado uma vez por dia pelo job opsDaily)
 *
 * Duas travas: o autorizador JWT so aceita o id token do app client do painel, e cada handler
 * confere o grupo `admin` no token (`requireAdmin`, 403 para os outros). Cada acesso vai para o
 * log com o sub de quem consultou (trilha para a LGPD), sem o termo buscado.
 *
 * Em producao as rotas sao servidas por uma Lambda so (`adminRouter`, pelo `routeKey`): o painel
 * e pouco usado, entao uma funcao quente atende todas as abas, e a permissao de leitura do Cognito
 * fica numa funcao so. `makeAdminHandlers({ repo, directory, content, now })` recebe as
 * dependencias (testes usam InMemoryRepo e um diretorio falso).
 */

import { opsOverview, accountSummary, listSquads, costView } from '../usecases/admin.js';
import { isUserId, parseAccountQuery, groupsOf } from '../domain/admin.js';
import { labelsFromReport } from '../content/contentReport.js';
import contentStatus from '../content/contentStatus.js';
import { claims, ok, fail, ApiError, wrap, requireAdmin } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { CognitoDirectory, makeCognitoClient } from '../adapters/cognitoDirectory.js';

const MAX_PAGE = 50;

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

export function makeAdminHandlers({ repo, directory, content = contentStatus, now = () => new Date(), log = console.log }) {
  const labels = labelsFromReport(content);
  const totalLessons = content.totals?.lessons ?? null;
  const query = (event) => event.queryStringParameters ?? {};

  /** Envelope comum: confere o grupo, registra o acesso e serializa. */
  const admin = (route, fn) =>
    wrap(async (event) => {
      const adminId = requireAdmin(event);
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

  const adminSearchAccountsHandler = admin('accounts.search', async (event) => {
    const parsed = parseAccountQuery(query(event).q);
    if (!parsed.ok) throw new ApiError(400, parsed.error, 'Busque por pelo menos 3 letras do e-mail ou pelo id');
    return { accounts: await directory.search(parsed.value, { limit: 10 }) };
  });

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

  const routes = {
    'GET /v1/admin/me': adminMeHandler,
    'GET /v1/admin/overview': adminOverviewHandler,
    'GET /v1/admin/content': adminContentHandler,
    'GET /v1/admin/accounts': adminSearchAccountsHandler,
    'GET /v1/admin/accounts/{userId}': adminAccountHandler,
    'GET /v1/admin/squads': adminSquadsHandler,
    'GET /v1/admin/cost': adminCostHandler,
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
    adminRouter,
    routeKeys: Object.keys(routes),
  };
}

export const { adminRouter } = makeAdminHandlers({
  repo: dynamoRepo,
  directory: new CognitoDirectory(makeCognitoClient(), process.env.USER_POOL_ID),
});
