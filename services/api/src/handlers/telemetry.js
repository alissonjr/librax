/**
 * Rotas publicas, sem login, dos dados de uso anonimos e da nota do app (docs/painel-admin.md,
 * "Uso anonimo"). Uma Lambda so (`librax-telemetry`, `telemetryRouter`, pelo `routeKey`).
 *
 * POST   /v1/telemetry        lote de eventos do app: { v, id, tz, snapshot, events }
 * DELETE /v1/telemetry/{id}   apaga a copia na nuvem do codigo anonimo (o proprio codigo e o segredo)
 * POST   /v1/feedback         nota de 1 a 5 e comentario opcional: { id, rating, text?, snapshot }
 *
 * Via de mao unica: a resposta nunca traz dado para o app (so contagens), e nada aqui le ou muda
 * conta, progresso ou o caminho do curso. Nao guarda IP nem User-Agent (o app manda so a
 * plataforma aproximada). Limite baixo por rota no estagio (infra/lib/cost-guards.ts) e permissao
 * da Lambda so nas chaves TEL#*, TELAGG e FBLIST* da tabela.
 *
 * Erros: 400 com o codigo da validacao, 413 corpo grande, 409 TELEMETRY_BUSY (dois lotes do mesmo
 * codigo ao mesmo tempo; o app tenta de novo depois).
 */

import { parseTelemetryBatch, isTelemetryId, TELEMETRY_MAX_BODY_BYTES } from '../domain/telemetry.js';
import { parseFeedback, FEEDBACK_MAX_BODY_BYTES } from '../domain/feedback.js';
import { ingestTelemetry, deleteTelemetry, submitFeedback, TelemetryBusyError } from '../usecases/telemetry.js';
import { body, ok, fail, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';
import { courseCatalog } from './_catalog.js';

export function makeTelemetryHandlers({ repo, catalog, now = () => new Date(), log = console.log }) {
  const telemetryHandler = wrap(async (event) => {
    const raw = body(event, { maxBytes: TELEMETRY_MAX_BODY_BYTES });
    const parsed = parseTelemetryBatch(raw, { catalog, now: now() });
    if (!parsed.ok) throw new ApiError(400, parsed.error, 'Lote de uso fora do formato');
    try {
      const result = await ingestTelemetry(repo, { batch: parsed.value, now: now() });
      return ok({ accepted: result.accepted, dropped: parsed.dropped });
    } catch (err) {
      if (err instanceof TelemetryBusyError) throw new ApiError(409, err.code, 'Tente de novo depois');
      throw err;
    }
  });

  const telemetryDeleteHandler = wrap(async (event) => {
    const id = event.pathParameters?.id;
    if (!isTelemetryId(id)) throw new ApiError(400, 'BAD_ID', 'Codigo anonimo invalido');
    const report = await deleteTelemetry(repo, { id });
    // so o fato, nunca o codigo
    log('[telemetry]', JSON.stringify({ deleted: true, feedback: report.feedback }));
    return ok({ ok: true });
  });

  const feedbackHandler = wrap(async (event) => {
    const raw = body(event, { maxBytes: FEEDBACK_MAX_BODY_BYTES });
    const parsed = parseFeedback(raw, { catalog });
    if (!parsed.ok) throw new ApiError(400, parsed.error, 'Nota fora do formato');
    await submitFeedback(repo, { value: parsed.value, now: now() });
    return ok({ ok: true });
  });

  const routes = {
    'POST /v1/telemetry': telemetryHandler,
    'DELETE /v1/telemetry/{id}': telemetryDeleteHandler,
    'POST /v1/feedback': feedbackHandler,
  };

  /** Uma Lambda para as tres rotas (pelo `routeKey` do API Gateway). */
  async function telemetryRouter(event) {
    const route = routes[event?.routeKey];
    if (!route) return fail('NOT_FOUND', 'Rota inexistente', 404);
    return route(event);
  }

  return { telemetryHandler, telemetryDeleteHandler, feedbackHandler, telemetryRouter, routeKeys: Object.keys(routes) };
}

export const { telemetryRouter } = makeTelemetryHandlers({ repo: dynamoRepo, catalog: courseCatalog });
