import { newProfile } from '../domain/profile.js';

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
    this._userLeague = new Map(); // userId -> leagueId
    this._leagueXp = new Map(); // `${leagueId}#${userId}` -> number
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
  async putSquad(squad) {
    this._squads.set(squad.squadId, { ...squad });
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
    this._squads.delete(squadId);
  }

  // --- squads: membros ---
  async getMember(squadId, userId) {
    const m = this._members.get(`${squadId}#${userId}`);
    return m ? { ...m } : null;
  }
  async putMember(squadId, userId, member) {
    this._members.set(`${squadId}#${userId}`, { userId, xpWeeklyContrib: 0, ...member });
    if (!this._userSquads.has(userId)) this._userSquads.set(userId, new Set());
    this._userSquads.get(userId).add(squadId);
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

  // --- squads: fan-out de XP semanal ---
  async listUserSquads(userId) {
    return [...(this._userSquads.get(userId) ?? [])].map((squadId) => ({
      squadId,
      type: this._squads.get(squadId)?.type,
    }));
  }
  async incrementSquadXp(squadId, userId, amount) {
    const squad = this._squads.get(squadId);
    if (squad) squad.xpWeekly = (squad.xpWeekly ?? 0) + amount;
    const member = this._members.get(`${squadId}#${userId}`);
    if (member) member.xpWeeklyContrib = (member.xpWeeklyContrib ?? 0) + amount;
  }
  async getSquadMemberXp(squadId, userId) {
    return this._members.get(`${squadId}#${userId}`)?.xpWeeklyContrib ?? 0;
  }

  // --- ligas: fan-out de XP semanal ---
  async getUserLeague(userId) {
    const leagueId = this._userLeague.get(userId);
    return leagueId ? { leagueId } : null;
  }
  async incrementLeagueXp(leagueId, userId, amount) {
    const key = `${leagueId}#${userId}`;
    this._leagueXp.set(key, (this._leagueXp.get(key) ?? 0) + amount);
  }
  async getLeagueMemberXp(leagueId, userId) {
    return this._leagueXp.get(`${leagueId}#${userId}`) ?? 0;
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
    this._userLeague.set(userId, leagueId);
  }
}
