import { type LibraxDB } from './db';

export class IdbRepo {
  constructor(private db: LibraxDB, private userId: string) {}

  // --- perfil ---
  async getProfile(_userId: string) {
    return (await this.db.get('profiles', this.userId)) ?? null;
  }

  /**
   * Na porta do repositorio as conquistas sao uma colecao separada do perfil (InMemoryRepo e
   * DynamoRepo usam itens proprios). Aqui elas ficam dentro do registro do perfil, entao o
   * saveProfile preserva as ja gravadas: o completeLesson salva no fim a copia do perfil lida
   * antes do addAchievement, e sem isso as conquistas novas sumiam e voltavam como novas.
   */
  async saveProfile(profile: object) {
    const incoming = profile as { achievements?: unknown };
    const stored = (await this.db.get('profiles', this.userId)) as { achievements?: unknown } | undefined;
    const achievements = mergeAchievements(stored?.achievements, incoming.achievements);
    await this.db.put('profiles', { ...profile, achievements });
  }

  // --- progresso de licao ---
  async getProgress(userId: string, lessonId: string) {
    return (await this.db.get('lesson_progress', [userId, lessonId])) ?? null;
  }

  async saveProgress(userId: string, lessonId: string, progress: object) {
    await this.db.put('lesson_progress', { userId, lessonId, ...progress });
  }

  /** Desfazer o teste de nivelamento (lib/placement.ts): a lição pulada volta a seguir a ordem. */
  async deleteProgress(userId: string, lessonId: string) {
    await this.db.delete('lesson_progress', [userId, lessonId]);
  }

  // --- SRS ---
  async getSrsItem(userId: string, signId: string) {
    return (await this.db.get('srs_items', [userId, signId])) ?? null;
  }

  async saveSrsItem(userId: string, signId: string, item: object) {
    await this.db.put('srs_items', { userId, signId, ...item });
  }

  async listSrsItems(userId: string) {
    const all = await this.db.getAll('srs_items');
    return all.filter((it: { userId: string }) => it.userId === userId);
  }

  // --- XP / log diario ---
  async getDayXp(userId: string, day: string): Promise<number> {
    const rec = await this.db.get('day_xp', [userId, day]);
    return (rec as { xp: number } | undefined)?.xp ?? 0;
  }

  async addDayXp(userId: string, day: string, xp: number) {
    const current = await this.getDayXp(userId, day);
    await this.db.put('day_xp', { userId, day, xp: current + xp });
  }

  async hasDayLog(userId: string, day: string): Promise<boolean> {
    return (await this.db.get('day_xp', [userId, day])) !== undefined;
  }

  // --- conquistas (guardadas no perfil) ---
  async listEarnedAchievements(userId: string): Promise<string[]> {
    const profile = await this.getProfile(userId);
    return (profile as { achievements?: string[] } | null)?.achievements ?? [];
  }

  async addAchievement(userId: string, code: string) {
    // Sem perfil salvo (primeira licao antes do init), grava um registro minimo para a
    // conquista nao se perder; o saveProfile seguinte completa o perfil e mantem a lista.
    const profile = ((await this.getProfile(userId)) as Record<string, unknown> | null) ?? { userId: this.userId };
    const list: string[] = Array.isArray(profile.achievements)
      ? (profile.achievements as string[])
      : [];
    if (!list.includes(code)) {
      await this.saveProfile({ ...profile, achievements: [...list, code] });
    }
  }

  // --- exclusao de dados (LGPD) ---
  /** Apaga todos os dados locais do usuario em todos os object stores. */
  async clearAllData() {
    const stores = [
      'profiles', 'lesson_progress', 'srs_items', 'day_xp', 'league_state', 'league_members', 'camera_stats',
    ] as const;
    await Promise.all(stores.map(store => this.db.clear(store)));
  }

  // --- squads: no-ops na PoC ---
  async listUserSquads() { return []; }
  async incrementSquadXp() {}

  // --- ligas: ficam no servidor (lib/league.ts); a lição feita aqui entra na liga pela fila ---
  async getUserLeague() { return null; }
  async incrementLeagueXp() {}
}

/** Uniao das listas de conquistas, sem repetir e mantendo a ordem em que foram ganhas. */
function mergeAchievements(stored: unknown, incoming: unknown): string[] {
  const out: string[] = [];
  for (const list of [stored, incoming]) {
    if (!Array.isArray(list)) continue;
    for (const code of list) {
      if (typeof code === 'string' && !out.includes(code)) out.push(code);
    }
  }
  return out;
}
