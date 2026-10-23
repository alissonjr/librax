import { addDays, parseIsoDate } from '../lib/dates.js';
import { opsKey, opsExpiry, DAY_RETENTION_DAYS, OPS_TIME_ZONE } from '../domain/opsMetrics.js';
import { utcOffsetMinutes } from '../domain/reminders.js';
import { costWindow, buildCostReport } from '../domain/costReport.js';

// Job diario do painel de administracao (handlers/opsDaily.js): traz do CloudWatch os erros do
// dia que acabou e do Cost Explorer o gasto do mes, e guarda tudo na tabela. A tela so le a
// tabela, entao abrir o painel nao custa nada no CloudWatch nem no Cost Explorer.

const NOON_MS = 12 * 60 * 60 * 1000;

/** Inicio e fim (UTC) do dia `day` no fuso do painel: em Brasilia, 03:00 a 03:00 UTC. */
export function opsDayWindow(day) {
  const at = (d) => {
    const midnightUtc = parseIsoDate(d);
    const offset = utcOffsetMinutes(new Date(midnightUtc + NOON_MS), OPS_TIME_ZONE);
    return new Date(midnightUtc - offset * 60 * 1000);
  };
  return { start: at(day), end: at(addDays(day, 1)) };
}

/**
 * Metricas pedidas ao CloudWatch para o dia.
 * @param {object} cfg { apiId, stage, functionNames: string[], tableName }
 */
export function cloudMetricQueries({ apiId, stage, functionNames = [], tableName }) {
  const api = { ApiId: apiId, Stage: stage };
  return [
    { id: 'api5xx', namespace: 'AWS/ApiGateway', metric: '5xx', dimensions: api },
    { id: 'api4xx', namespace: 'AWS/ApiGateway', metric: '4xx', dimensions: api },
    { id: 'apiRequests', namespace: 'AWS/ApiGateway', metric: 'Count', dimensions: api },
    { id: 'lambdaThrottles', namespace: 'AWS/Lambda', metric: 'Throttles' },
    { id: 'ddbReadThrottles', namespace: 'AWS/DynamoDB', metric: 'ReadThrottleEvents', dimensions: { TableName: tableName } },
    { id: 'ddbWriteThrottles', namespace: 'AWS/DynamoDB', metric: 'WriteThrottleEvents', dimensions: { TableName: tableName } },
    ...functionNames.map((name, i) => ({
      id: `fn${i}`, namespace: 'AWS/Lambda', metric: 'Errors', dimensions: { FunctionName: name }, functionName: name,
    })),
  ];
}

/**
 * Erros do servidor do dia `day`, gravados em OPS / DAY#<dia> como `cloud` (SET: rodar de novo
 * so regrava o mesmo dia).
 * @returns {Promise<object>} o que foi gravado
 */
export async function collectCloudMetrics(repo, cloud, { day, apiId, stage, functionNames, tableName, collectedAt }) {
  const queries = cloudMetricQueries({ apiId, stage, functionNames, tableName });
  const sums = await cloud.sums(queries, opsDayWindow(day));
  const errorsByFunction = {};
  let lambdaErrors = 0;
  for (const q of queries) {
    if (!q.functionName) continue;
    const n = Math.round(sums[q.id] ?? 0);
    lambdaErrors += n;
    if (n > 0) errorsByFunction[q.functionName] = n;
  }
  const value = (id) => Math.round(sums[id] ?? 0);
  const result = {
    api5xx: value('api5xx'),
    api4xx: value('api4xx'),
    apiRequests: value('apiRequests'),
    lambdaErrors,
    lambdaThrottles: value('lambdaThrottles'),
    ddbThrottles: value('ddbReadThrottles') + value('ddbWriteThrottles'),
    errorsByFunction,
    collectedAt,
  };
  await repo.setOpsFields(opsKey.day(day), { cloud: result }, { expiresAt: opsExpiry(day, DAY_RETENTION_DAYS) });
  return result;
}

/** Gasto do mes por servico (uma chamada ao Cost Explorer), gravado em OPS / COST#<mes>. */
export async function collectMonthCost(repo, costs, { now }) {
  const window = costWindow(now);
  const { currency, services } = await costs.byService({ start: window.start, end: window.end });
  const report = buildCostReport(window, services, { currency, asOf: now.toISOString() });
  await repo.setOpsFields(opsKey.cost(window.month), report);
  return report;
}
