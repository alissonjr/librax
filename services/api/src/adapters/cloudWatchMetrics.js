/**
 * Leitura das metricas do CloudWatch para o job diario do painel (erros do servidor por dia).
 *
 * GetMetricData cobra US$ 0,01 por mil metricas pedidas; o job pede umas 30 por dia. O periodo e
 * de 1 hora e a soma do dia e feita aqui: assim o dia de Brasilia (03:00 a 03:00 UTC) nao depende
 * do alinhamento do periodo de 1 dia do CloudWatch.
 *
 * Requer `cloudwatch:GetMetricData` (o recurso e sempre `*`).
 */

import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

/** Limite de consultas por chamada do GetMetricData. */
const MAX_QUERIES = 500;
const HOUR_S = 3600;

export function makeCloudWatchClient(options = {}) {
  return new CloudWatchClient(options);
}

export class CloudWatchMetrics {
  /** @param {{send: Function}} client CloudWatchClient (ou um falso nos testes) */
  constructor(client) {
    this._client = client;
  }

  /**
   * Soma de cada metrica entre `start` e `end`.
   * @param {Array<{id: string, namespace: string, metric: string, dimensions?: object, stat?: string}>} queries
   *   `id` no formato do CloudWatch (comeca com minuscula, so letras, numeros e _)
   * @param {{start: Date, end: Date}} window
   * @returns {Promise<Record<string, number>>}
   */
  async sums(queries, { start, end }) {
    const out = Object.fromEntries(queries.map((q) => [q.id, 0]));
    for (let i = 0; i < queries.length; i += MAX_QUERIES) {
      const MetricDataQueries = queries.slice(i, i + MAX_QUERIES).map((q) => ({
        Id: q.id,
        ReturnData: true,
        MetricStat: {
          Metric: {
            Namespace: q.namespace,
            MetricName: q.metric,
            Dimensions: Object.entries(q.dimensions ?? {}).map(([Name, Value]) => ({ Name, Value })),
          },
          Period: HOUR_S,
          Stat: q.stat ?? 'Sum',
        },
      }));
      let NextToken;
      do {
        const res = await this._client.send(
          new GetMetricDataCommand({ StartTime: start, EndTime: end, MetricDataQueries, ScanBy: 'TimestampAscending', NextToken }),
        );
        for (const r of res.MetricDataResults ?? []) {
          out[r.Id] = (out[r.Id] ?? 0) + (r.Values ?? []).reduce((acc, v) => acc + v, 0);
        }
        NextToken = res.NextToken;
      } while (NextToken);
    }
    return out;
  }
}
