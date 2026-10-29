import { buildGlobalRanking, isListedInGlobalRanking, GLOBAL_RANKING_TOP } from '../domain/ranking.js';

/**
 * GET /v1/ranking/global: topo do ranking de todos os tempos (XP total) e a posicao de quem
 * chama. A entrada no ranking e gravada junto com o perfil (licao, migracao e PUT do perfil);
 * perfil gravado antes do ranking ganha a entrada aqui, na primeira leitura, se a pessoa nao saiu
 * dele. Sem perfil (nenhuma licao nem nome ainda) a pessoa fica de fora, sem gravar nada.
 *
 * A posicao de quem chama e 1 + quantos tem XP estritamente maior (contagem paginada no
 * indice), entao vale para qualquer posicao, nao so para o topo.
 *
 * @param {object} repo
 * @param {{userId: string, limit?: number}} input
 * @returns {Promise<{top: {rank: number, name: string|null, xp: number, isYou: boolean}[],
 *   you: {rank: number|null, xp: number, listed: boolean}}>}
 */
export async function getGlobalRanking(repo, input) {
  const { userId, limit = GLOBAL_RANKING_TOP } = input;

  const [profile, indexed] = await Promise.all([repo.getProfile(userId), repo.hasGlobalRankingEntry(userId)]);
  const xp = profile?.xpTotal ?? 0;
  let listed = indexed;
  if (!indexed && profile && isListedInGlobalRanking(profile)) {
    listed = await repo.addGlobalRankingEntry(userId, xp);
  }

  const [entries, above] = await Promise.all([
    repo.listGlobalRanking(limit),
    listed ? repo.countGlobalRankingAbove(xp) : 0,
  ]);
  return buildGlobalRanking({ entries, viewerId: userId, xp, listed, above });
}
