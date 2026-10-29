import { newProfile } from '../domain/profile.js';
import { isListedInGlobalRanking } from '../domain/ranking.js';
import { periodKey, periodStartOf } from '../domain/leagues.js';

/**
 * PUT /v1/users/me/profile: nome de quem estuda (o do onboarding) e a escolha de aparecer no
 * ranking global. `changes` ja vem validado (domain/profile.js: parseProfileUpdate).
 *
 * - Sem perfil ainda (conta nova, antes da primeira licao): cria com o padrao, so se ninguem criou
 *   antes (uma migracao do convidado ao mesmo tempo nunca perde XP).
 * - Grava so os campos dados e poe ou tira a entrada do ranking global pela escolha final.
 * - Nome novo vai tambem para a linha da pessoa na liga da semana e em cada squad dela, que e de
 *   onde os rankings leem o nome. Repete mesmo sem mudanca: preenche linhas gravadas antes.
 *
 * @param {object} repo
 * @param {{userId: string, changes: {displayName?: string, showInGlobalRanking?: boolean}, nowMs: number}} input
 * @returns {Promise<{displayName: string|null, showInGlobalRanking: boolean}>}
 */
export async function updateProfile(repo, input) {
  const { userId, changes, nowMs } = input;

  let profile = await repo.getProfile(userId);
  if (!profile) {
    await repo.createProfile(newProfile(userId));
    profile = await repo.getProfile(userId);
  }

  const listed = isListedInGlobalRanking({ ...profile, ...changes });
  await repo.updateProfileSettings(userId, changes, { listed, xpTotal: profile.xpTotal ?? 0 });

  const displayName = changes.displayName ?? profile.displayName ?? null;
  if (changes.displayName !== undefined) {
    await propagateDisplayName(repo, { userId, displayName, nowMs });
  }
  return { displayName, showInGlobalRanking: listed };
}

/** Nome novo na vaga da liga da semana (se a pessoa ja entrou) e em todas as squads dela. */
async function propagateDisplayName(repo, { userId, displayName, nowMs }) {
  const seat = await repo.getLeaguePlacement(userId, periodKey(periodStartOf(nowMs)));
  if (seat) await repo.setLeagueMemberName(seat.leagueId, userId, displayName);
  for (const { squadId } of await repo.listUserSquads(userId)) {
    await repo.setSquadMemberName(squadId, userId, displayName);
  }
}
