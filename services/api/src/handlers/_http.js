/**
 * Utilitarios para handlers Lambda do API Gateway (HTTP API formato 2.0).
 *
 * - `userId(event)` extrai o sub do Cognito authorizer.
 * - `body(event)` faz parse do JSON do body.
 * - `ok(data, status?)` serializa resposta de sucesso.
 * - `fail(code, message, status?)` serializa erro com corpo padrao.
 */

/** Sub do Cognito JWT injetado pelo authorizer nativo do API Gateway HTTP API. */
export function userId(event) {
  const sub = event.requestContext?.authorizer?.jwt?.claims?.sub;
  if (!sub) throw new ApiError(401, 'UNAUTHORIZED', 'Token ausente ou invalido');
  return sub;
}

/** Parse JSON do body; lanca 400 se ausente ou malformado. */
export function body(event) {
  const raw = event.body;
  if (!raw) throw new ApiError(400, 'MISSING_BODY', 'Body obrigatorio');
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'BAD_JSON', 'Body nao e JSON valido');
  }
}

/** Resposta 200 (ou status custom). */
export function ok(data, status = 200) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  };
}

/** Resposta de erro com envelope { error: { code, message } }. */
export function fail(code, message, status = 400) {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code, message } }),
  };
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Wrapper que captura ApiError e erros de dominio e serializa como fail().
 * Uso: `export const handler = wrap(async event => { ... return ok(data); });`
 */
export function wrap(fn) {
  return async (event) => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof ApiError) return fail(err.code, err.message, err.status);
      console.error('[handler]', err);
      return fail('INTERNAL_ERROR', 'Erro interno', 500);
    }
  };
}
