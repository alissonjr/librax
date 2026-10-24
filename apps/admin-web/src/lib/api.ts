import { currentToken } from './auth';
import type { AccountSummary, Account, ContentStatus, CostView, Me, Overview, SquadRow } from './types';

/*
 * Cliente das rotas /v1/admin (só leitura). O id token vai no Authorization: Bearer; a API confere
 * o grupo admin e responde 403 para os outros.
 */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface AdminApi {
  me(): Promise<Me>;
  overview(): Promise<Overview>;
  content(): Promise<ContentStatus>;
  searchAccounts(q: string): Promise<{ accounts: Account[] }>;
  account(userId: string): Promise<AccountSummary>;
  squads(cursor?: string | null): Promise<{ squads: SquadRow[]; cursor: string | null }>;
  cost(): Promise<CostView>;
}

export function httpApi({
  base = import.meta.env.VITE_API_BASE || '/api',
  token = () => currentToken(),
  fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
}: { base?: string; token?: () => string | null; fetchFn?: typeof fetch } = {}): AdminApi {
  async function get<T>(path: string, query?: Record<string, string | null | undefined>): Promise<T> {
    const idToken = token();
    if (!idToken) throw new ApiError(401, 'UNAUTHORIZED', 'Sessão expirada');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
    const qs = params.toString();
    const res = await fetchFn(`${base}/v1/admin${path}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Erro ao falar com a API');
    }
    return body as T;
  }

  return {
    me: () => get('/me'),
    overview: () => get('/overview'),
    content: () => get('/content'),
    searchAccounts: (q) => get('/accounts', { q }),
    account: (userId) => get(`/accounts/${encodeURIComponent(userId)}`),
    squads: (cursor) => get('/squads', { cursor: cursor ?? null }),
    cost: () => get('/cost'),
  };
}
