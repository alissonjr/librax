import { buildDailyQueue } from '../domain/dailyQueue.js';

/**
 * GET /users/me/dailyQueue (SPEC 02 secao 6).
 * Carrega os itens SRS do usuario e os sinais do curriculo ainda nao aprendidos,
 * e delega a montagem da fila ao dominio.
 *
 * @param {object} repo
 * @param {{signsOrder: string[]}} content  ordem dos sinais no curriculo
 * @param {{userId: string, today: string, size?: number}} input
 */
export async function getDailyQueue(repo, content, input) {
  const { userId, today, size = 10 } = input;

  const srsItems = await repo.listSrsItems(userId);
  const learned = new Set(srsItems.map((it) => it.signId));
  const newSigns = (content.signsOrder ?? []).filter((signId) => !learned.has(signId));

  return buildDailyQueue(srsItems, newSigns, { size, today });
}
