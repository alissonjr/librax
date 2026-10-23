import { rankLeague, closeLeague } from '@domain/leagues.js';
import { formatIsoDate } from '@apilib/dates.js';

/**
 * Ligas semanais (spec-02 seções 5.5 e 12.7, design system 4.4 e 11.9).
 *
 * ============================== MODO LOCAL / DEMO ==============================
 * Ainda não há API de ligas nem outros usuários neste aparelho. Este módulo roda o domínio
 * (services/api/src/domain/leagues.js: rankLeague e closeLeague) localmente, sobre o IdbRepo:
 * - o XP da semana da pessoa é real: vem do fan-out do usecase completeLesson
 *   (repo.getUserLeague + repo.incrementLeagueXp), gravado no IndexedDB;
 * - os outros 29 membros são SIMULADOS, gerados de forma determinística a partir do id da liga
 *   (tier + semana): a mesma semana mostra sempre as mesmas pessoas e o XP delas cresce ao longo
 *   da semana sem nunca voltar;
 * - o fechamento da semana acontece aqui, na primeira leitura depois da segunda 00:00 UTC.
 * Para trocar pela API: substituir `syncLeague` e `loadLeagueView` por chamadas ao backend
 * (liga atual pelo GSI2, membros por PK=LEAGUE#<id>, resultado do Lambda closeLeague) e apagar
 * `simulatedMembers`. A tela (LeagueScreen) só depende de `LeagueView`.
 * ==============================================================================
 */
export const LEAGUE_MODE = 'local-demo' as const;

// ---------- ligas ----------

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

export const LEAGUE_SIZE = 30;
export const PROMOTE = 3;
export const RELEGATE = 10;

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

/** Bronze não rebaixa (é a primeira) e Diamante não promove (é a última). */
export function zoneOpts(tier: TierId): { promote: number; relegate: number } {
  return {
    promote: tierAbove(tier) ? PROMOTE : 0,
    relegate: tierBelow(tier) ? RELEGATE : 0,
  };
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

/** Ex.: 'bronze-2026-w43' (o formato do leagueId do handler closeLeague). */
export function leagueIdOf(tier: TierId, periodStart: number): string {
  const { year, week } = isoWeek(periodStart);
  return `${tier}-${year}-w${String(week).padStart(2, '0')}`;
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

// ---------- membros simulados (MODO LOCAL / DEMO) ----------

/** mulberry32: gerador determinístico pequeno. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash FNV-1a de 32 bits (semente a partir do id da liga). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Nomes genéricos (primeiro nome + inicial), sem referência a pessoas reais.
const FIRST_NAMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Eduarda', 'Felipe', 'Gabriela', 'Heitor', 'Isabela', 'João',
  'Karina', 'Lucas', 'Mariana', 'Nicolas', 'Olívia', 'Paulo', 'Rafaela', 'Samuel', 'Tânia', 'Vinícius',
  'Yasmin', 'André', 'Beatriz', 'Caio', 'Débora', 'Enzo', 'Fernanda', 'Gustavo', 'Helena', 'Igor',
  'Júlia', 'Leandro', 'Marcos', 'Natália', 'Otávio', 'Patrícia', 'Renato', 'Sofia', 'Thiago', 'Valéria',
];
const INITIALS = 'ABCDFGLMNOPRSTV';

/** XP médio por dia de estudo, por liga: ligas altas reúnem quem estuda mais. */
const DAILY_XP_BY_TIER: Record<TierId, number> = {
  bronze: 25, prata: 32, ouro: 40, safira: 48, rubi: 56, ametista: 64, diamante: 72,
};

export interface SimulatedMember {
  userId: string;
  name: string;
  xpPeriod: number;
}

/**
 * MODO LOCAL / DEMO: os outros membros da liga, simulados.
 * Determinístico por liga (tier + semana): cada membro tem dias e horários de estudo sorteados
 * pela semente; o XP conta só as sessões que já aconteceram até `nowMs` (monótono na semana).
 */
export function simulatedMembers(
  tier: TierId,
  periodStart: number,
  nowMs: number,
  count = LEAGUE_SIZE - 1,
): SimulatedMember[] {
  const leagueId = leagueIdOf(tier, periodStart);
  const pick = rng(hash(leagueId));
  const names = [...FIRST_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(pick() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }
  const base = DAILY_XP_BY_TIER[tier];
  const out: SimulatedMember[] = [];
  for (let i = 0; i < count; i++) {
    const r = rng(hash(`${leagueId}#${i}`));
    const name = `${names[i % names.length]} ${INITIALS[Math.floor(r() * INITIALS.length)]}.`;
    // Constância: de quem entra pouco (0,15) a quem estuda quase todo dia (0,95)
    const consistency = 0.15 + r() * 0.8;
    const intensity = 0.5 + r() * 1.1;
    let xp = 0;
    for (let d = 0; d < 7; d++) {
      const studies = r() < consistency;
      const sessionXp = Math.round((base * intensity * (0.6 + r() * 0.8)) / 5) * 5;
      const at = periodStart + d * DAY_MS + Math.floor((7 + r() * 16) * 60 * 60 * 1000); // entre 7h e 23h UTC
      if (studies && at <= nowMs) xp += Math.max(5, sessionXp);
    }
    out.push({ userId: `sim-${String(i + 1).padStart(2, '0')}`, name, xpPeriod: xp });
  }
  return out;
}

// ---------- estado e repositório ----------

export type LeagueOutcome = 'promoted' | 'stayed' | 'relegated';

export interface LeagueResult {
  periodStart: number;
  fromTier: TierId;
  toTier: TierId;
  outcome: LeagueOutcome;
  rank: number;
  total: number;
  xp: number;
}

export interface LeagueState {
  userId: string;
  tier: TierId;
  periodStart: number;
  /** Resultado da última semana encerrada (para o LeagueResultSheet). */
  lastResult?: LeagueResult;
}

/** Parte do IdbRepo que as ligas usam (facilita testar e trocar pela API). */
export interface LeagueRepo {
  getLeagueState(userId: string): Promise<LeagueState | null>;
  saveLeagueState(state: LeagueState): Promise<void>;
  getLeagueMemberXp(leagueId: string, userId: string): Promise<number>;
  setLeagueMemberXp(leagueId: string, userId: string, xp: number): Promise<void>;
  getDayXp(userId: string, day: string): Promise<number>;
}

/** XP já registrado nos dias da semana (dados de antes das ligas existirem). */
async function weekDayXp(repo: LeagueRepo, userId: string, periodStart: number): Promise<number> {
  let sum = 0;
  for (let d = 0; d < 7; d++) sum += await repo.getDayXp(userId, formatIsoDate(periodStart + d * DAY_MS));
  return sum;
}

/** Fecha a semana `state.periodStart` com o domínio (closeLeague) e devolve o resultado. */
async function closePeriod(repo: LeagueRepo, state: LeagueState): Promise<LeagueResult> {
  const leagueId = leagueIdOf(state.tier, state.periodStart);
  const xp = await repo.getLeagueMemberXp(leagueId, state.userId);
  const end = periodEndOf(state.periodStart);
  const members = [
    { userId: state.userId, xpPeriod: xp },
    ...simulatedMembers(state.tier, state.periodStart, end).map(m => ({ userId: m.userId, xpPeriod: m.xpPeriod })),
  ];
  const opts = zoneOpts(state.tier);
  const { promoted, relegated } = closeLeague(members, opts) as { promoted: string[]; relegated: string[] };
  const ranked = rankLeague(members, opts) as Array<{ userId: string; rank: number }>;
  const rank = ranked.find(m => m.userId === state.userId)?.rank ?? members.length;
  let outcome: LeagueOutcome = 'stayed';
  let toTier = state.tier;
  if (promoted.includes(state.userId)) {
    outcome = 'promoted';
    toTier = tierAbove(state.tier) ?? state.tier;
  } else if (relegated.includes(state.userId)) {
    outcome = 'relegated';
    toTier = tierBelow(state.tier) ?? state.tier;
  }
  return { periodStart: state.periodStart, fromTier: state.tier, toTier, outcome, rank, total: members.length, xp };
}

/**
 * Liga atual da pessoa, já com a virada de semana aplicada.
 * - Sem liga: com `enroll`, entra na Bronze desta semana (com `seedFromDays`, leva o XP já feito
 *   na semana); sem `enroll`, devolve null (estado vazio da spec-05 11.3).
 * - Semana nova: fecha a última semana em que estava (closeLeague do domínio), guarda o resultado
 *   em `lastResult` e passa para a liga nova na semana atual. Semanas sem nenhuma abertura do app
 *   no meio não geram rebaixamentos extras.
 */
export async function syncLeague(
  repo: LeagueRepo,
  userId: string,
  nowMs: number,
  opts: { enroll: boolean; seedFromDays?: boolean },
): Promise<LeagueState | null> {
  const current = periodStartOf(nowMs);
  const state = await repo.getLeagueState(userId);

  if (!state) {
    if (!opts.enroll) return null;
    const fresh: LeagueState = { userId, tier: 'bronze', periodStart: current };
    if (opts.seedFromDays) {
      const seed = await weekDayXp(repo, userId, current);
      if (seed > 0) await repo.setLeagueMemberXp(leagueIdOf('bronze', current), userId, seed);
    }
    await repo.saveLeagueState(fresh);
    return fresh;
  }

  if (state.periodStart >= current) return state;

  const result = await closePeriod(repo, state);
  const next: LeagueState = { userId, tier: result.toTier, periodStart: current, lastResult: result };
  await repo.saveLeagueState(next);
  return next;
}

// ---------- visão da tela ----------

export type Zone = 'promotion' | 'stay' | 'relegation';

export interface RankingRow {
  userId: string;
  name: string;
  xpPeriod: number;
  rank: number;
  zone: Zone;
  isYou: boolean;
  simulated: boolean;
}

export interface LeagueView {
  mode: typeof LEAGUE_MODE;
  tier: TierId;
  leagueId: string;
  week: number;
  periodStart: number;
  periodEnd: number;
  rows: RankingRow[];
  you: RankingRow;
  promote: number;
  relegate: number;
  /** Resultado da semana anterior ainda não visto (flag local leagueResultSeen). */
  pendingResult: LeagueResult | null;
}

const SEEN_KEY = 'librax_leagueResultSeen';

/** leagueResultSeen: <period> (spec-02 12.7). Guarda o início da semana encerrada já mostrada. */
export function leagueResultSeen(): number | null {
  try {
    const v = localStorage.getItem(SEEN_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function markLeagueResultSeen(periodStart: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(periodStart));
  } catch {
    /* sem localStorage: o sheet pode reaparecer, sem outro efeito */
  }
}

/** Ranking da liga atual (domínio: rankLeague) com a pessoa e os membros simulados. */
export async function buildLeagueView(
  repo: LeagueRepo,
  state: LeagueState,
  nowMs: number,
  displayName: string,
): Promise<LeagueView> {
  const leagueId = leagueIdOf(state.tier, state.periodStart);
  const xp = await repo.getLeagueMemberXp(leagueId, state.userId);
  const sims = simulatedMembers(state.tier, state.periodStart, nowMs);
  const names = new Map(sims.map(s => [s.userId, s.name]));
  names.set(state.userId, displayName);
  const opts = zoneOpts(state.tier);
  const ranked = rankLeague(
    [{ userId: state.userId, xpPeriod: xp }, ...sims.map(s => ({ userId: s.userId, xpPeriod: s.xpPeriod }))],
    opts,
  ) as Array<{ userId: string; xpPeriod: number; rank: number; zone: Zone }>;
  const rows: RankingRow[] = ranked.map(m => ({
    ...m,
    name: names.get(m.userId) ?? m.userId,
    isYou: m.userId === state.userId,
    simulated: m.userId !== state.userId,
  }));
  const seen = leagueResultSeen();
  const pending = state.lastResult && state.lastResult.periodStart !== seen ? state.lastResult : null;
  return {
    mode: LEAGUE_MODE,
    tier: state.tier,
    leagueId,
    week: isoWeek(state.periodStart).week,
    periodStart: state.periodStart,
    periodEnd: periodEndOf(state.periodStart),
    rows,
    you: rows.find(r => r.isYou)!,
    promote: opts.promote,
    relegate: opts.relegate,
    pendingResult: pending,
  };
}

/**
 * Carrega a tela de ligas: aplica a virada de semana e monta o ranking.
 * Devolve null quando a pessoa ainda não tem liga (estado vazio). Quem já tem XP nesta semana
 * entra na Bronze aqui mesmo; quem não tem entra ao concluir a primeira lição.
 */
export async function loadLeagueView(
  repo: LeagueRepo,
  userId: string,
  nowMs: number,
  displayName: string,
): Promise<LeagueView | null> {
  const hasXp = (await weekDayXp(repo, userId, periodStartOf(nowMs))) > 0;
  const state = await syncLeague(repo, userId, nowMs, { enroll: hasXp, seedFromDays: true });
  if (!state) return null;
  return buildLeagueView(repo, state, nowMs, displayName);
}
