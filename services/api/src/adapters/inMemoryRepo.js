import { newProfile } from '../domain/profile.js';
import { offsetBucket } from '../domain/reminders.js';
import { freshPeriods } from '../domain/opsMetrics.js';

/** Item do painel como o DynamoRepo devolve: com a chave e sem o TTL. */
const opsView = ({ expiresAt, ...item }) => structuredClone(item);

/**
 * Adaptador de repositorio em memoria que implementa a porta usada pelos usecases.
 * Espelha os padroes de acesso da tabela single-table (SPEC 02 secao 3 / SPEC 04 secao 1)
 * sem depender de AWS. Serve para testes e para rodar a logica localmente.
 *
 * O adaptador real (DynamoDB) implementa a mesma interface de metodos.
 */
export class InMemoryRepo {
  constructor() {
    this._profiles = new Map(); // userId -> profile
    this._progress = new Map(); // `${userId}#${lessonId}` -> progress
    this._srs = new Map(); // `${userId}#${signId}` -> item
    this._dayXp = new Map(); // `${userId}#${day}` -> number
    this._daysLogged = new Set(); // `${userId}#${day}`
    this._achievements = new Map(); // userId -> Set(code)
    this._squads = new Map(); // squadId -> META
    this._members = new Map(); // `${squadId}#${userId}` -> { userId, role, xpWeeklyContrib, joinedAt }
    this._userSquads = new Map(); // userId -> Set(squadId)
    this._invite = new Map(); // inviteCode -> squadId
    this._squadWeeks = new Map(); // `${squadId}#${period}` -> semana da squad (ativa ou fechada, com ranking)
    this._userLeague = new Map(); // userId -> { leagueId, period } (a liga mais recente)
    this._leagueXp = new Map(); // `${leagueId}#${userId}` -> number
    this._leagues = new Map(); // leagueId -> META { leagueId, tier, period, periodStart, group?, status }
    this._leagueMembers = new Map(); // leagueId -> Set(userId)
    this._leagueState = new Map(); // userId -> { tier, lastResult, lastClosedPeriod }
    this._leaguePlacement = new Map(); // `${userId}#${period}` -> { leagueId, tier, period } (uma liga por semana)
    this._leagueGroups = new Map(); // `${tier}#${period}` -> grupo aberto (cursor de alocacao)
    this._leagueNames = new Map(); // `${leagueId}#${userId}` -> displayName
    this._leagueSeen = new Map(); // userId -> period do ultimo resultado visto
    this._attempts = new Map(); // `${userId}#${lessonAttemptId}` -> { status, lessonId, result }
    this._push = new Map(); // userId -> Map(subscriptionId -> { endpoint, keys })
    this._notif = new Map(); // userId -> preferencias + estado de lembrete (+ balde de fuso)
    this._ops = new Map(); // chave do painel (DAY#..., WEEK#..., COST#...) -> item (OPS / <chave>)
    this._activity = new Map(); // userId -> { lastDay, lastWeek, lastMonth }
  }

  // --- perfil ---
  async getProfile(userId) {
    return this._profiles.get(userId) ?? null;
  }
  async saveProfile(profile) {
    this._profiles.set(profile.userId, { ...profile });
  }

  // --- progresso de licao ---
  async getProgress(userId, lessonId) {
    return this._progress.get(`${userId}#${lessonId}`) ?? null;
  }
  async saveProgress(userId, lessonId, progress) {
    this._progress.set(`${userId}#${lessonId}`, { ...progress });
  }
  async listProgress(userId) {
    const prefix = `${userId}#`;
    const out = [];
    for (const [key, p] of this._progress) {
      if (key.startsWith(prefix)) out.push({ lessonId: key.slice(prefix.length), ...p });
    }
    return out;
  }

  // --- SRS ---
  async getSrsItem(userId, signId) {
    return this._srs.get(`${userId}#${signId}`) ?? null;
  }
  async saveSrsItem(userId, signId, item) {
    this._srs.set(`${userId}#${signId}`, { ...item });
  }
  async listSrsItems(userId) {
    const prefix = `${userId}#`;
    const out = [];
    for (const [key, item] of this._srs) {
      if (key.startsWith(prefix)) out.push({ signId: key.slice(prefix.length), ...item });
    }
    return out;
  }

  // --- XP / log do dia ---
  async getDayXp(userId, day) {
    return this._dayXp.get(`${userId}#${day}`) ?? 0;
  }
  async addDayXp(userId, day, xp) {
    const key = `${userId}#${day}`;
    this._dayXp.set(key, (this._dayXp.get(key) ?? 0) + xp);
    this._daysLogged.add(key);
  }
  async hasDayLog(userId, day) {
    return this._daysLogged.has(`${userId}#${day}`);
  }

  // --- conquistas ---
  async listEarnedAchievements(userId) {
    return [...(this._achievements.get(userId) ?? [])];
  }
  async addAchievement(userId, code) {
    if (!this._achievements.has(userId)) this._achievements.set(userId, new Set());
    this._achievements.get(userId).add(code);
  }

  // --- squads: META ---
  /** So na criacao: depois disso, cada escrita mexe so nos proprios campos. */
  async putSquad(squad) {
    this._squads.set(squad.squadId, { ...squad });
  }
  /** Grava so os campos dados (nunca o XP nem o memberCount); devolve a squad atualizada. */
  async updateSquadFields(squadId, fields) {
    const squad = this._squads.get(squadId);
    if (!squad) throw new Error(`squad inexistente: ${squadId}`);
    Object.assign(squad, fields);
    return { ...squad };
  }
  /** Soma `delta` ao memberCount; para entrar (delta > 0) so se houver vaga. */
  async changeSquadMemberCount(squadId, delta) {
    const squad = this._squads.get(squadId);
    if (!squad) return false;
    if (delta > 0 && (squad.memberCount ?? 0) >= squad.maxMembers) return false;
    squad.memberCount = (squad.memberCount ?? 0) + delta;
    return true;
  }
  async getSquad(squadId) {
    const s = this._squads.get(squadId);
    return s ? { ...s } : null;
  }
  async deleteSquad(squadId) {
    const squad = this._squads.get(squadId);
    if (squad?.inviteCode) this._invite.delete(squad.inviteCode);
    for (const member of await this.listMembers(squadId)) {
      this._members.delete(`${squadId}#${member.userId}`);
      this._userSquads.get(member.userId)?.delete(squadId);
    }
    for (const key of [...this._squadWeeks.keys()]) {
      if (key.startsWith(`${squadId}#`)) this._squadWeeks.delete(key);
    }
    this._squads.delete(squadId);
  }

  /** Squads da mais nova para a mais velha (registro SQUADINDEX do DynamoRepo). */
  async listSquadIndex({ limit = 25, cursor = null } = {}) {
    const all = [...this._squads.values()]
      .map(({ squadId, createdAt }) => ({ squadId, createdAt: createdAt ?? null }))
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.squadId.localeCompare(a.squadId));
    const start = cursor ?? 0;
    const end = start + limit;
    return { squads: all.slice(start, end), cursor: end < all.length ? end : null };
  }

  // --- squads: membros ---
  async getMember(squadId, userId) {
    const m = this._members.get(`${squadId}#${userId}`);
    return m ? { ...m } : null;
  }
  /** Membro novo; false se a pessoa ja e membro (nao sobrescreve). */
  async putMember(squadId, userId, member) {
    const key = `${squadId}#${userId}`;
    if (this._members.has(key)) return false;
    this._members.set(key, { userId, xpWeeklyContrib: 0, ...member });
    if (!this._userSquads.has(userId)) this._userSquads.set(userId, new Set());
    this._userSquads.get(userId).add(squadId);
    return true;
  }
  /** Troca so o papel (promote, demote, transfer), sem regravar a contribuicao. */
  async setMemberRole(squadId, userId, role) {
    const member = this._members.get(`${squadId}#${userId}`);
    if (!member) throw new Error(`membro inexistente: ${squadId}/${userId}`);
    member.role = role;
  }
  async removeMember(squadId, userId) {
    this._members.delete(`${squadId}#${userId}`);
    this._userSquads.get(userId)?.delete(squadId);
  }
  async listMembers(squadId) {
    const out = [];
    for (const [key, m] of this._members) {
      if (key.startsWith(`${squadId}#`)) out.push({ ...m });
    }
    return out;
  }
  async countAdmins(squadId) {
    return (await this.listMembers(squadId)).filter((m) => m.role === 'admin').length;
  }
  async countUserB2cSquads(userId) {
    let n = 0;
    for (const squadId of this._userSquads.get(userId) ?? []) {
      if (this._squads.get(squadId)?.type !== 'org') n += 1;
    }
    return n;
  }

  // --- squads: indice de convite ---
  async indexInvite(code, squadId) {
    this._invite.set(code, squadId);
  }
  async findSquadIdByInvite(code) {
    return this._invite.get(code) ?? null;
  }
  async removeInvite(code) {
    this._invite.delete(code);
  }

  // --- squads: fan-out de XP semanal ---
  async listUserSquads(userId) {
    return [...(this._userSquads.get(userId) ?? [])].map((squadId) => ({
      squadId,
      type: this._squads.get(squadId)?.type,
    }));
  }
  /**
   * Soma XP na squad e no membro (mesmas regras do DynamoRepo):
   * - `period` ('AAAA-wSS'): XP semanal da semana `period`; se o item ainda e de uma semana
   *   velha, vira a semana (o valor anterior vai para lastWeekXp/lastWeekPeriod) e a squad
   *   fica marcada como ativa na semana (SQUAD#<id> / WEEK#<semana>, lida pelo job);
   * - `period: null`: licao de outra semana, so soma no total (xpAllTime);
   * - sem `period` (seeds e testes antigos): soma direto no semanal, sem semana.
   */
  async incrementSquadXp(squadId, userId, amount, { period } = {}) {
    const squad = this._squads.get(squadId);
    if (squad && this._addWeekXp(squad, 'xpWeekly', 'xpAllTime', amount, period)) {
      const key = `${squadId}#${period}`;
      if (!this._squadWeeks.has(key)) this._squadWeeks.set(key, { squadId, period, status: 'open' });
    }
    const member = this._members.get(`${squadId}#${userId}`);
    if (member) this._addWeekXp(member, 'xpWeeklyContrib', 'xpAllTimeContrib', amount, period);
  }
  /** @returns {boolean} true se virou a semana do item */
  _addWeekXp(item, weekly, allTime, amount, period) {
    item[allTime] = (item[allTime] ?? 0) + amount;
    if (period === undefined) {
      item[weekly] = (item[weekly] ?? 0) + amount;
      return false;
    }
    if (period === null || (item.xpWeekPeriod && item.xpWeekPeriod > period)) return false;
    if (item.xpWeekPeriod === period) {
      item[weekly] = (item[weekly] ?? 0) + amount;
      return false;
    }
    if (item.xpWeekPeriod) {
      item.lastWeekXp = item[weekly] ?? 0;
      item.lastWeekPeriod = item.xpWeekPeriod;
    }
    item[weekly] = amount;
    item.xpWeekPeriod = period;
    return true;
  }

  // --- squads: reset semanal e historico (SQUAD#<id> / WEEK#<semana>) ---
  async listSquadWeeks(period, { limit = 25, cursor = null } = {}) {
    const all = [...this._squadWeeks.values()]
      .filter((w) => w.period === period)
      .sort((a, b) => (a.squadId < b.squadId ? -1 : 1));
    const start = cursor ?? 0;
    const end = start + limit;
    return {
      weeks: all.slice(start, end).map(({ squadId, status }) => ({ squadId, period, status })),
      cursor: end < all.length ? end : null,
    };
  }
  /** Vira a semana `period` da squad e dos membros que ainda estao nela (XP semanal a zero). */
  async rollSquadWeek(squadId, period) {
    const roll = (item, weekly) => {
      if (item?.xpWeekPeriod !== period) return;
      item.lastWeekXp = item[weekly] ?? 0;
      item.lastWeekPeriod = period;
      item[weekly] = 0;
      delete item.xpWeekPeriod;
    };
    roll(this._squads.get(squadId), 'xpWeekly');
    for (const [key, member] of this._members) {
      if (key.startsWith(`${squadId}#`)) roll(member, 'xpWeeklyContrib');
    }
  }
  /** Fecha a semana uma vez so; false se ja estava fechada. */
  async saveSquadWeek(squadId, period, snapshot) {
    const key = `${squadId}#${period}`;
    const current = this._squadWeeks.get(key);
    if (current?.status === 'closed') return false;
    this._squadWeeks.set(key, { ...current, ...snapshot, squadId, period, status: 'closed' });
    return true;
  }
  async getSquadWeek(squadId, period) {
    const w = this._squadWeeks.get(`${squadId}#${period}`);
    return w ? structuredClone(w) : null;
  }
  async getSquadMemberXp(squadId, userId) {
    return this._members.get(`${squadId}#${userId}`)?.xpWeeklyContrib ?? 0;
  }

  // --- ligas: fan-out de XP semanal ---
  async getUserLeague(userId) {
    const l = this._userLeague.get(userId);
    return l ? { ...l } : null;
  }
  async incrementLeagueXp(leagueId, userId, amount) {
    const key = `${leagueId}#${userId}`;
    this._leagueXp.set(key, (this._leagueXp.get(key) ?? 0) + amount);
    this._addLeagueMember(leagueId, userId);
  }

  // --- ligas: semana, membros e fechamento (espelha GSI2 LEAGUES#<semana> do DynamoRepo) ---
  /** Cria o META da liga (aberta) ou atualiza os dados sem mexer no status. */
  async putLeague(league) {
    this._putLeague(league);
  }
  _putLeague(league) {
    const current = this._leagues.get(league.leagueId);
    this._leagues.set(league.leagueId, { ...current, ...league, status: current?.status ?? 'open' });
  }
  async getLeague(leagueId) {
    const l = this._leagues.get(leagueId);
    return l ? { ...l } : null;
  }
  /**
   * Entra na liga (idempotente): nao zera o XP de quem ja esta nela. Uma liga por pessoa e
   * semana (vaga em `USER#<id> / LEAGUEWEEK#<semana>`); com `maxMembers`, so entra se o
   * `memberCount` do META ainda estiver abaixo dele (mesma regra do contador condicional).
   * @returns {Promise<{status: 'joined'|'already'|'full', leagueId: string}>}
   */
  async joinLeague(league, userId, { maxMembers = null, displayName = null } = {}) {
    const seatKey = `${userId}#${league.period}`;
    const seat = this._leaguePlacement.get(seatKey);
    if (seat) return { status: 'already', leagueId: seat.leagueId };
    const meta = this._leagues.get(league.leagueId);
    if (maxMembers != null && (meta?.memberCount ?? 0) >= maxMembers) {
      return { status: 'full', leagueId: league.leagueId };
    }

    // sem await entre a checagem e a escrita: atomico como a transacao do DynamoRepo
    this._putLeague(league);
    const updated = this._leagues.get(league.leagueId);
    updated.memberCount = (updated.memberCount ?? 0) + 1;
    this._leaguePlacement.set(seatKey, { leagueId: league.leagueId, tier: league.tier, period: league.period });
    this._addLeagueMember(league.leagueId, userId);
    const key = `${league.leagueId}#${userId}`;
    if (!this._leagueXp.has(key)) this._leagueXp.set(key, 0);
    if (displayName) this._leagueNames.set(key, displayName);
    const current = this._userLeague.get(userId);
    if (!current?.period || current.period <= league.period) {
      this._userLeague.set(userId, { leagueId: league.leagueId, period: league.period });
    }
    return { status: 'joined', leagueId: league.leagueId };
  }
  async getLeaguePlacement(userId, period) {
    const p = this._leaguePlacement.get(`${userId}#${period}`);
    return p ? { ...p } : null;
  }
  /** Grupo aberto da liga `tier` na semana (1 se ninguem encheu um grupo ainda). */
  async getLeagueGroupCursor(tier, period) {
    return this._leagueGroups.get(`${tier}#${period}`) ?? 1;
  }
  /** Quem viu o grupo `fromGroup` cheio avanca o cursor; se outro ja avancou, vale o atual. */
  async advanceLeagueGroup(tier, period, fromGroup) {
    const key = `${tier}#${period}`;
    const cursor = this._leagueGroups.get(key) ?? 1;
    if (cursor === fromGroup) this._leagueGroups.set(key, fromGroup + 1);
    return this._leagueGroups.get(key) ?? 1;
  }
  async listLeaguesOfPeriod(period, { limit = 25, cursor = null } = {}) {
    const all = [...this._leagues.values()]
      .filter((l) => l.period === period)
      .sort((a, b) => (a.leagueId < b.leagueId ? -1 : 1));
    const start = cursor ?? 0;
    const end = start + limit;
    return { leagues: all.slice(start, end).map((l) => ({ ...l })), cursor: end < all.length ? end : null };
  }
  async listLeagueMembers(leagueId) {
    return [...(this._leagueMembers.get(leagueId) ?? [])].map((userId) => {
      const displayName = this._leagueNames.get(`${leagueId}#${userId}`);
      return {
        userId,
        xpPeriod: this._leagueXp.get(`${leagueId}#${userId}`) ?? 0,
        ...(displayName ? { displayName } : {}),
      };
    });
  }
  /** Grava o resultado da semana uma vez so; repetido devolve o que ja estava gravado. */
  async applyLeagueResult(userId, result) {
    const state = this._leagueState.get(userId);
    if (state?.lastClosedPeriod && state.lastClosedPeriod >= result.period) {
      return { applied: false, result: { ...state.lastResult } };
    }
    this._leagueState.set(userId, { tier: result.toTier, lastResult: { ...result }, lastClosedPeriod: result.period });
    return { applied: true, result };
  }
  async getLeagueState(userId) {
    const s = this._leagueState.get(userId);
    return s ? { ...s, lastResult: { ...s.lastResult } } : null;
  }
  /** Semana do ultimo LeagueResultSheet visto (so anda para frente). */
  async markLeagueResultSeen(userId, period) {
    const current = this._leagueSeen.get(userId);
    if (!current || current < period) this._leagueSeen.set(userId, period);
  }
  async getLeagueResultSeen(userId) {
    return this._leagueSeen.get(userId) ?? null;
  }
  async markLeagueClosed(leagueId, summary = {}) {
    const l = this._leagues.get(leagueId);
    if (!l) throw new Error(`liga inexistente: ${leagueId}`);
    this._leagues.set(leagueId, { ...l, ...summary, status: 'closed' });
  }
  _addLeagueMember(leagueId, userId) {
    if (!this._leagueMembers.has(leagueId)) this._leagueMembers.set(leagueId, new Set());
    this._leagueMembers.get(leagueId).add(userId);
  }
  async getLeagueMemberXp(leagueId, userId) {
    return this._leagueXp.get(`${leagueId}#${userId}`) ?? 0;
  }

  // --- tentativas de licao (idempotencia por lessonAttemptId) ---
  async claimLessonAttempt(userId, lessonAttemptId, meta = {}) {
    const key = `${userId}#${lessonAttemptId}`;
    if (this._attempts.has(key)) return false;
    this._attempts.set(key, { ...meta, status: 'pending' });
    return true;
  }
  async getLessonAttempt(userId, lessonAttemptId) {
    const a = this._attempts.get(`${userId}#${lessonAttemptId}`);
    return a ? { ...a } : null;
  }
  async finishLessonAttempt(userId, lessonAttemptId, result) {
    const key = `${userId}#${lessonAttemptId}`;
    this._attempts.set(key, { ...this._attempts.get(key), status: 'done', result: { ...result } });
  }
  async releaseLessonAttempt(userId, lessonAttemptId) {
    const key = `${userId}#${lessonAttemptId}`;
    if (this._attempts.get(key)?.status === 'pending') this._attempts.delete(key);
  }

  // --- Web Push: inscricoes (USER#<id> / PUSH#<hash>) ---
  async putPushSubscription(userId, subscriptionId, sub) {
    if (!this._push.has(userId)) this._push.set(userId, new Map());
    this._push.get(userId).set(subscriptionId, { ...sub });
  }
  async deletePushSubscription(userId, subscriptionId) {
    this._push.get(userId)?.delete(subscriptionId);
  }
  async listPushSubscriptions(userId) {
    return [...(this._push.get(userId) ?? new Map())].map(([subscriptionId, sub]) => ({ subscriptionId, ...sub }));
  }

  // --- lembretes: preferencias + estado (USER#<id> / NOTIF, indice por balde de fuso) ---
  async getNotifState(userId) {
    const n = this._notif.get(userId);
    return n ? { ...n } : null;
  }
  async saveNotifState(userId, record, now = new Date()) {
    const bucket = record.reminderHour != null ? offsetBucket(now, record.timezone) : null;
    this._notif.set(userId, { ...record, userId, bucket });
  }
  async listNotifCandidates(bucket) {
    return [...this._notif.values()].filter((n) => n.bucket === bucket).map((n) => ({ ...n }));
  }

  // --- painel de administracao: contadores agregados (OPS / <chave>) e atividade ---
  async getActivity(userId) {
    const a = this._activity.get(userId);
    return a ? { ...a } : null;
  }
  /** Marca a pessoa como ativa no dia, semana e mes; devolve o que ainda nao tinha sido contado. */
  async markActivity(userId, periods) {
    const fresh = freshPeriods(this._activity.get(userId), periods);
    if (fresh.day) {
      this._activity.set(userId, { lastDay: periods.day, lastWeek: periods.week, lastMonth: periods.month });
    }
    return fresh;
  }
  /** Soma os contadores (ADD); o TTL e o do primeiro registro do item. */
  async addOpsCounters(key, counters, { expiresAt = null } = {}) {
    const item = this._ops.get(key) ?? { key };
    for (const [name, n] of Object.entries(counters)) item[name] = (item[name] ?? 0) + n;
    if (expiresAt != null && item.expiresAt == null) item.expiresAt = expiresAt;
    this._ops.set(key, item);
  }
  /** Grava os campos dados (SET), sem mexer nos contadores. */
  async setOpsFields(key, fields, { expiresAt = null } = {}) {
    const item = this._ops.get(key) ?? { key };
    Object.assign(item, structuredClone(fields));
    if (expiresAt != null && item.expiresAt == null) item.expiresAt = expiresAt;
    this._ops.set(key, item);
  }
  async getOpsItem(key) {
    const item = this._ops.get(key);
    return item ? opsView(item) : null;
  }
  /** Itens com chave entre `from` e `to` (inclusive), em ordem. */
  async listOpsRange(from, to) {
    return [...this._ops.values()]
      .filter((i) => i.key >= from && i.key <= to)
      .sort((a, b) => (a.key < b.key ? -1 : 1))
      .map(opsView);
  }
  /** Os `limit` itens mais recentes com o prefixo (WEEK#, MONTH#, COST#). */
  async listOpsLatest(prefix, limit) {
    return [...this._ops.values()]
      .filter((i) => i.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .slice(0, limit)
      .map(opsView);
  }

  // --- helpers de seed (so para testes / dev) ---
  async seedProfile(overrides) {
    const p = newProfile(overrides.userId, overrides);
    this._profiles.set(p.userId, p);
    return p;
  }
  async seedSquad(squadId, { type = 'public', maxMembers = 30 } = {}) {
    await this.putSquad({ squadId, type, maxMembers, memberCount: 0, xpWeekly: 0 });
  }
  async addSquadMember(squadId, userId, role = 'member') {
    await this.putMember(squadId, userId, { role });
    const squad = this._squads.get(squadId);
    if (squad) squad.memberCount = (squad.memberCount ?? 0) + 1;
  }
  async seedLeague(leagueId, userId) {
    this._userLeague.set(userId, { leagueId });
  }
}
