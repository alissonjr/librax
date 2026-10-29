import { callApi } from './sync';

/**
 * Ligas semanais (spec-02 seções 5.5 e 12.7, design system 4.4 e 11.9), lidas do servidor.
 *
 * A pessoa entra na liga da semana na primeira lição que conta nela (POST /v1/lesson/complete) e o
 * job de segunda-feira fecha as ligas. Aqui o app só lê a liga (GET /v1/league/current) e marca o
 * resultado como visto (POST /v1/league/result-seen). Ligas são só com conta: sem sessão, a tela
 * mostra o convite para criar uma. Nada de membros simulados: o ranking tem só pessoas de verdade,
 * mesmo quando a liga ainda tem pouca gente.
 */

export const TIERS = ['bronze', 'prata', 'ouro', 'safira', 'rubi', 'ametista', 'diamante'] as const;
export type TierId = (typeof TIERS)[number];

/** Nome escrito de cada liga (a cor nunca vem sozinha: design system 4.4). */
export const TIER_NAMES: Record<TierId, string> = {
  bronze: 'Bronze',
  prata: 'Prata',
  ouro: 'Ouro',
  safira: 'Safira',
  rubi: 'Rubi',
  ametista: 'Ametista',
  diamante: 'Diamante',
};

/** Vagas de uma liga (services/api/src/domain/leagues.js). Abaixo disso, a liga ainda está enchendo. */
export const LEAGUE_SIZE = 30;

export function tierIndex(tier: TierId): number {
  return TIERS.indexOf(tier);
}

export function tierAbove(tier: TierId): TierId | null {
  return TIERS[tierIndex(tier) + 1] ?? null;
}

export function tierBelow(tier: TierId): TierId | null {
  const i = tierIndex(tier);
  return i > 0 ? TIERS[i - 1] : null;
}

// ---------- semana (período) ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Início do período: segunda-feira 00:00 UTC (mesmo job que fecha ligas e squads, spec-04 0.3). */
export function periodStartOf(nowMs: number): number {
  const d = new Date(nowMs);
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return midnight - sinceMonday * DAY_MS;
}

export function periodEndOf(periodStart: number): number {
  return periodStart + WEEK_MS;
}

/** Semana ISO 8601 (a quinta-feira da semana decide o ano). */
export function isoWeek(periodStart: number): { year: number; week: number } {
  const thursday = new Date(periodStart + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / WEEK_MS) + 1;
  return { year, week };
}

/** Tempo restante em partes, para "Encerra em 2d 5h". */
export function timeLeft(nowMs: number, endMs: number): { days: number; hours: number; minutes: number } {
  const ms = Math.max(0, endMs - nowMs);
  const totalMin = Math.floor(ms / 60000);
  return {
    days: Math.floor(totalMin / (24 * 60)),
    hours: Math.floor((totalMin % (24 * 60)) / 60),
    minutes: totalMin % 60,
  };
}

// ---------- visão da liga (formato do GET /v1/league/current) ----------

export type LeagueOutcome = 'promoted' | 'stayed' | 'relegated';
export type Zone = 'promotion' | 'stay' | 'relegation';

export interface LeagueResult {
  /** Semana encerrada, 'AAAA-wSS' (o que o POST /v1/league/result-seen recebe). */
  period: string;
  periodStart: number;
  fromTier: TierId;
  toTier: TierId;
  outcome: LeagueOutcome;
  rank: number;
  total: number;
  xp: number;
}

export interface RankingRow {
  userId: string;
  /** Nome escolhido no app; null quando a pessoa ainda não mandou um para o servidor. */
  name: string | null;
  xpPeriod: number;
  rank: number;
  zone: Zone;
  isYou: boolean;
}

export interface LeagueView {
  /** false: ainda sem liga nesta semana (entra na `tier` ao concluir uma lição). */
  enrolled: boolean;
  tier: TierId;
  leagueId: string | null;
  week: number;
  period: string;
  periodStart: number;
  periodEnd: number;
  rows: RankingRow[];
  you: RankingRow | null;
  promote: number;
  relegate: number;
  /** Resultado da semana anterior ainda não visto. */
  pendingResult: LeagueResult | null;
}

export type LeagueLoad =
  | { kind: 'ok'; view: LeagueView }
  | { kind: 'guest' }
  | { kind: 'offline' };

const isTier = (v: unknown): v is TierId => typeof v === 'string' && (TIERS as readonly string[]).includes(v);

function isView(v: unknown): v is LeagueView {
  const o = v as Partial<LeagueView> | null;
  return !!o && typeof o === 'object' && isTier(o.tier) && Array.isArray(o.rows) && typeof o.periodEnd === 'number';
}

/** Leitura curta guardada: o atalho da aba Social e o do Perfil não buscam de novo a cada visita. */
const CACHE_MS = 60_000;
let cache: { at: number; load: LeagueLoad } | null = null;

/**
 * Liga da semana pelo servidor. `fresh` ignora a leitura guardada e espera a fila de lições sair
 * antes (a tela da liga já mostra o XP da lição que acabou de ser feita).
 */
export async function fetchLeague(opts: { fresh?: boolean; now?: () => number } = {}): Promise<LeagueLoad> {
  const now = opts.now ?? Date.now;
  if (!opts.fresh && cache && now() - cache.at < CACHE_MS) return cache.load;
  const res = await callApi<unknown>('GET', '/v1/league/current', { flush: opts.fresh });
  let load: LeagueLoad;
  if (res.kind === 'guest') load = { kind: 'guest' };
  else if (res.kind === 'ok' && isView(res.data)) load = { kind: 'ok', view: withSeen(res.data) };
  else load = { kind: 'offline' };
  if (load.kind !== 'offline') cache = { at: now(), load };
  return load;
}

/** Esquece a leitura guardada (troca de conta, testes). */
export function forgetLeague(): void {
  cache = null;
}

const SEEN_KEY = 'librax_leagueResultSeen';

function seenPeriod(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** Tira o resultado já mostrado neste aparelho, mesmo que o aviso ao servidor ainda não tenha chegado. */
function withSeen(view: LeagueView): LeagueView {
  const pending = view.pendingResult;
  return pending && pending.period === seenPeriod() ? { ...view, pendingResult: null } : view;
}

/**
 * Marca o resultado como visto (spec-02 12.7: ao exibir, não ao fechar): guarda no aparelho e
 * avisa o servidor. Sem rede, o aparelho já não repete o aviso; o servidor recebe na próxima vez.
 */
export function markLeagueResultSeen(result: LeagueResult): void {
  try {
    localStorage.setItem(SEEN_KEY, result.period);
  } catch {
    /* sem localStorage: o sheet pode reaparecer, sem outro efeito */
  }
  if (cache?.load.kind === 'ok') cache = { ...cache, load: { kind: 'ok', view: { ...cache.load.view, pendingResult: null } } };
  void callApi('POST', '/v1/league/result-seen', { body: { period: result.period } });
}

/** Resultado da semana encerrada ainda não visto, para o AppOpenFlow. Sem conta ou sem rede: null. */
export async function pendingLeagueResult(): Promise<LeagueResult | null> {
  const load = await fetchLeague({ fresh: true });
  return load.kind === 'ok' ? load.view.pendingResult : null;
}
