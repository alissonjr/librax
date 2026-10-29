// Ranking global de todos os tempos: todo mundo que nao saiu dele, pelo XP total do perfil
// (xpTotal). Regras puras; a entrada no indice (GSI4 `RANK#ALL` / `XP#<xp>`, no proprio item
// do perfil) fica no adaptador.

/** Quantas pessoas o GET /v1/ranking/global devolve no topo. */
export const GLOBAL_RANKING_TOP = 50;

/** Maior XP que cabe na chave do indice (10 digitos com zero a esquerda). */
export const GLOBAL_RANKING_MAX_XP = 10 ** 10 - 1;

/** Quem nunca escolheu fica no ranking (padrao ligado); so `false` tira. */
export function isListedInGlobalRanking(profile) {
  return profile?.showInGlobalRanking !== false;
}

/** XP como entra na chave do indice: inteiro entre 0 e o maximo de 10 digitos. */
export function rankingXp(xp) {
  const n = Math.floor(Number(xp));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, GLOBAL_RANKING_MAX_XP);
}

/**
 * Resposta do GET /v1/ranking/global. Posicao por competicao: quem empata divide a posicao e a
 * seguinte pula (1, 2, 2, 4), ou seja 1 + quantos tem XP estritamente maior. Nunca devolve o
 * id de ninguem: so o nome guardado (ou null), o XP e se a linha e de quem chamou.
 *
 * @param {{entries: {userId: string, displayName?: string|null, xp: number}[], viewerId: string,
 *   xp: number, listed: boolean, above: number}} input
 *   entries: o topo, do maior para o menor XP; above: quantos tem XP estritamente maior que o de
 *   quem chamou (so vale com `listed`)
 */
export function buildGlobalRanking({ entries, viewerId, xp, listed, above }) {
  const top = [];
  entries.forEach((e, i) => {
    const rank = i > 0 && e.xp === entries[i - 1].xp ? top[i - 1].rank : i + 1;
    top.push({ rank, name: e.displayName ?? null, xp: e.xp, isYou: e.userId === viewerId });
  });
  return {
    top,
    you: { rank: listed ? above + 1 : null, xp, listed },
  };
}
