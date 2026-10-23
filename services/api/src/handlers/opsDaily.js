/**
 * Lambda acionada pelo EventBridge Scheduler todo dia as 03:30 UTC (00:30 em Brasilia) para o
 * painel de administracao (usecases/collectDailyOps.js):
 *   1. erros do servidor do dia que acabou (CloudWatch: 5xx e 4xx da API, erros por Lambda,
 *      throttling da Lambda e do DynamoDB) em OPS / DAY#<dia>;
 *   2. gasto do mes por servico (Cost Explorer, uma chamada) em OPS / COST#<mes>.
 *
 * As duas partes sao independentes (uma falha nao impede a outra) e regravam o mesmo item, entao
 * rodar de novo nao soma nada. Para refazer um dia a mao: { "day": "2026-10-22" }; para nao
 * consultar o Cost Explorer (US$ 0,01 por chamada): { "skipCost": true }.
 *
 * Variaveis de ambiente: API_ID, API_STAGE, FUNCTION_NAMES (separadas por virgula), LIBRAX_TABLE.
 *
 * `makeOpsDailyHandler({ repo, cloud, costs, config, now })` recebe as dependencias (testes usam
 * InMemoryRepo e falsos); `handler` e a instancia de producao.
 */

import { addDays } from '../lib/dates.js';
import { isRealDate } from '../domain/lessonCompletion.js';
import { opsToday } from '../domain/opsMetrics.js';
import { collectCloudMetrics, collectMonthCost } from '../usecases/collectDailyOps.js';
import { CloudWatchMetrics, makeCloudWatchClient } from '../adapters/cloudWatchMetrics.js';
import { CostExplorerCosts, makeCostExplorerClient } from '../adapters/costExplorer.js';
import { repo as dynamoRepo } from './_repo.js';

export function makeOpsDailyHandler({ repo, cloud, costs, config, now = () => new Date() }) {
  async function handler(event = {}) {
    const at = now();
    const day = isRealDate(event?.day) ? event.day : addDays(opsToday(at), -1);

    const [metrics, cost] = await Promise.allSettled([
      collectCloudMetrics(repo, cloud, { ...config, day, collectedAt: at.toISOString() }),
      event?.skipCost ? Promise.resolve(null) : collectMonthCost(repo, costs, { now: at }),
    ]);

    const report = {
      day,
      cloud: metrics.status === 'fulfilled' ? metrics.value : { error: String(metrics.reason?.message ?? metrics.reason) },
      cost: cost.status === 'fulfilled'
        ? cost.value && { month: cost.value.month, total: cost.value.total, projectedTotal: cost.value.projectedTotal }
        : { error: String(cost.reason?.message ?? cost.reason) },
    };
    console.log('[opsDaily]', JSON.stringify(report));
    // falha conta no alarme de erros das Lambdas; a outra parte ja foi gravada
    if (metrics.status === 'rejected') throw metrics.reason;
    if (cost.status === 'rejected') throw cost.reason;
    return report;
  }
  return { handler };
}

const env = process.env;
export const { handler } = makeOpsDailyHandler({
  repo: dynamoRepo,
  cloud: new CloudWatchMetrics(makeCloudWatchClient()),
  costs: new CostExplorerCosts(makeCostExplorerClient()),
  config: {
    apiId: env.API_ID,
    stage: env.API_STAGE ?? 'api',
    functionNames: (env.FUNCTION_NAMES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    tableName: env.LIBRAX_TABLE ?? 'librax',
  },
});
