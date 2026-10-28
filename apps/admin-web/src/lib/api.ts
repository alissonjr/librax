import { sharedAuth } from './auth';
import type { AccountSummary, Account, ContentStatus, CostView, Me, Overview, OverviewDays, SquadRow } from './types';
import type { FeedbackPage, Usage } from './usageTypes';

/*
 * Cliente das rotas /v1/admin (só leitura). O id token vai no Authorization: Bearer; a API confere
 * o grupo admin e responde 403 para os outros. O token vencido é renovado antes (lib/auth.ts).
 */

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface AdminApi {
  me(): Promise<Me>;
  overview(days?: OverviewDays): Promise<Overview>;
  content(): Promise<ContentStatus>;
  searchAccounts(q: string): Promise<{ accounts: Account[] }>;
  /** Todas as contas, uma página por vez (ordem do Cognito); `cursor` vem da página anterior. */
  listAccounts(cursor?: string | null): Promise<{ accounts: Account[]; cursor: string | null }>;
  account(userId: string): Promise<AccountSummary>;
  /** Ações sobre uma conta (outra Lambda, a única do painel que escreve). */
  disableAccount(userId: string): Promise<{ ok: true; enabled: boolean }>;
  enableAccount(userId: string): Promise<{ ok: true; enabled: boolean }>;
  /** Exclui a conta e os dados; `confirm` é o e-mail da conta, digitado por quem está no painel. */
  deleteAccount(userId: string, confirm: string): Promise<{ ok: true }>;
  squads(cursor?: string | null): Promise<{ squads: SquadRow[]; cursor: string | null }>;
  cost(): Promise<CostView>;
  /** Uso anônimo do app (ativos, retenção, funil, lições, notas). */
  usage(): Promise<Usage>;
  /** Notas do app, da mais nova para a mais velha; `rating` filtra por estrela. */
  feedback(opts?: { rating?: number | null; cursor?: string | null }): Promise<FeedbackPage>;
}

export function httpApi({
  base = import.meta.env.VITE_API_BASE || '/api',
  token = () => sharedAuth().idToken(),
  fetchFn = (...args: Parameters<typeof fetch>) => fetch(...args),
}: { base?: string; token?: () => string | null | Promise<string | null>; fetchFn?: typeof fetch } = {}): AdminApi {
  async function request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    query?: Record<string, string | null | undefined>,
    payload?: unknown,
  ): Promise<T> {
    const idToken = await token();
    if (!idToken) throw new ApiError(401, 'UNAUTHORIZED', 'Sessão expirada');
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
    const qs = params.toString();
    const res = await fetchFn(`${base}/v1/admin${path}${qs ? `?${qs}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? 'Erro ao falar com a API');
    }
    return body as T;
  }
  const get = <T,>(path: string, query?: Record<string, string | null | undefined>) => request<T>('GET', path, query);

  return {
    me: () => get('/me'),
    overview: (days) => get('/overview', { days: days ? String(days) : null }),
    content: () => get('/content'),
    searchAccounts: (q) => get('/accounts', { q }),
    listAccounts: (cursor) => get('/accounts', { cursor: cursor ?? null }),
    account: (userId) => get(`/accounts/${encodeURIComponent(userId)}`),
    disableAccount: (userId) => request('POST', `/accounts/${encodeURIComponent(userId)}/disable`),
    enableAccount: (userId) => request('POST', `/accounts/${encodeURIComponent(userId)}/enable`),
    deleteAccount: (userId, confirm) => request('DELETE', `/accounts/${encodeURIComponent(userId)}`, undefined, { confirm }),
    squads: (cursor) => get('/squads', { cursor: cursor ?? null }),
    cost: () => get('/cost'),
    usage: () => get('/usage'),
    feedback: ({ rating = null, cursor = null } = {}) => get('/feedback', { rating: rating ? String(rating) : null, cursor }),
  };
}
