/**
 * Lambda acionada pelo EventBridge Scheduler toda segunda 00:05 UTC para fechar a semana
 * das ligas (SPEC 02 secao 5.5): ranking, promocao/rebaixamento e montagem das ligas da
 * semana seguinte, em todas as ligas da semana que terminou (usecases/closeLeagueWeek.js).
 *
 * O evento do Scheduler nao precisa de nada. Para refazer uma semana a mao (a operacao e
 * idempotente), mande a segunda-feira dela:
 *   { "periodStart": "2026-10-19" }
 *
 * Nao usa API Gateway (nao e HTTP); o evento chega diretamente.
 *
 * `makeCloseLeagueHandler({ repo, now })` recebe as dependencias (testes usam InMemoryRepo);
 * `handler` e a instancia de producao (DynamoRepo).
 */

import { closeLeagueWeek } from '../usecases/closeLeagueWeek.js';
import { periodStartOf } from '../domain/leagues.js';
import { parseIsoDate } from '../lib/dates.js';
import { repo as dynamoRepo } from './_repo.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function makeCloseLeagueHandler({ repo, now = () => new Date() }) {
  async function handler(event = {}) {
    const periodStart = event?.periodStart
      ? parseIsoDate(event.periodStart)
      : periodStartOf(now().getTime()) - WEEK_MS; // a semana que acabou de terminar

    const report = await closeLeagueWeek(repo, { periodStart, closedAt: now().toISOString() });
    console.log('[closeLeague]', JSON.stringify(report));
    return report;
  }
  return { handler };
}

export const { handler } = makeCloseLeagueHandler({ repo: dynamoRepo });
