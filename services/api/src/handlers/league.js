/**
 * Handlers Lambda das ligas semanais (SPEC 02 secoes 5.5 e 12.7).
 *
 * GET  /v1/league/current      -> getCurrentLeague (liga, ranking, tempo ate o fechamento e
 *                                 o resultado anterior ainda nao visto)
 * POST /v1/league/result-seen  -> markLeagueResultSeen, corpo { period: 'AAAA-wSS' }
 *
 * A entrada na liga acontece na primeira licao da semana (POST /v1/lesson/complete); estas
 * rotas so leem e marcam o LeagueResultSheet como visto.
 *
 * `makeLeagueHandlers({ repo, now })` recebe as dependencias (testes usam InMemoryRepo);
 * os exports nomeados sao as instancias de producao (DynamoRepo).
 */

import { getCurrentLeague, markLeagueResultSeen } from '../usecases/leagueView.js';
import { userId, body, ok, ApiError, wrap } from './_http.js';
import { repo as dynamoRepo } from './_repo.js';

export function makeLeagueHandlers({ repo, now = () => new Date() }) {
  /** GET /v1/league/current */
  const getCurrentLeagueHandler = wrap(async (event) => {
    const uid = userId(event);
    return ok(await getCurrentLeague(repo, { userId: uid, nowMs: now().getTime() }));
  });

  /** POST /v1/league/result-seen */
  const markLeagueResultSeenHandler = wrap(async (event) => {
    const uid = userId(event);
    const { period } = body(event);
    try {
      return ok(await markLeagueResultSeen(repo, { userId: uid, period, nowMs: now().getTime() }));
    } catch (err) {
      if (err.message === 'INVALID_PERIOD') {
        throw new ApiError(400, 'INVALID_PERIOD', 'period deve ser uma semana encerrada (AAAA-wSS)');
      }
      throw err;
    }
  });

  return { getCurrentLeagueHandler, markLeagueResultSeenHandler };
}

export const { getCurrentLeagueHandler, markLeagueResultSeenHandler } = makeLeagueHandlers({ repo: dynamoRepo });
