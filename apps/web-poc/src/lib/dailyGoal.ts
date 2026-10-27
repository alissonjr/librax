import { newProfile } from '@domain/profile.js';

/**
 * Meta diária de XP (`dailyGoalXp` do perfil): escolhida nas boas-vindas e nas Configurações, lida
 * pelo mapa, pelo perfil e pelo completeLesson local (meta do dia batida).
 *
 * Fica só no perfil deste aparelho (IndexedDB). O servidor tem o mesmo campo (domain/profile.js,
 * padrão 20), mas nenhuma rota recebe a meta hoje: com conta, o "meta batida" do servidor segue com 20.
 */

/** Opções oferecidas nas boas-vindas e nas Configurações. */
export const DAILY_GOALS = [5, 10, 20, 50] as const;

/** Meta de quem nunca escolheu (a mesma do newProfile do domínio). */
export const DEFAULT_DAILY_GOAL = 20;

/** O pedaço do repositório local (IdbRepo) que a meta usa. */
export interface ProfileStore {
  getProfile(userId: string): Promise<unknown>;
  saveProfile(profile: object): Promise<void>;
}

/** Meta guardada num perfil já lido; sem valor válido, a padrão. */
export function dailyGoalOf(profile: unknown): number {
  const value = (profile as { dailyGoalXp?: unknown } | null)?.dailyGoalXp;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_DAILY_GOAL;
}

export async function loadDailyGoal(repo: ProfileStore, userId: string): Promise<number> {
  return dailyGoalOf(await repo.getProfile(userId));
}

/**
 * Grava a meta sem apagar o resto do perfil: o saveProfile do IdbRepo troca o registro inteiro,
 * então lê, junta e salva. Sem perfil ainda, parte do perfil padrão.
 */
export async function saveDailyGoal(repo: ProfileStore, userId: string, xp: number): Promise<void> {
  const stored = (await repo.getProfile(userId)) as Record<string, unknown> | null;
  const base = stored ?? { ...newProfile(userId), achievements: [] };
  await repo.saveProfile({ ...base, dailyGoalXp: xp });
}
