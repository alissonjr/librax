/**
 * Falsos explicitos do ambiente local para o que nao tem simulacao aqui: CloudWatch
 * (GetMetricData), Cost Explorer (GetCostAndUsage) e Web Push. O AWS Budget e os alarmes so
 * existem na infra (nao ha codigo que os chame).
 *
 * Os numeros sao inventados, mas estaveis: o mesmo dia da sempre o mesmo valor, para o painel
 * nao mudar a cada execucao do job. Tudo que sai daqui leva "simulado" no log.
 */

import { createHash } from 'node:crypto';

/** Numero de 0 a 1 estavel por texto. */
function unit(text) {
  return createHash('sha256').update(text).digest().readUInt32BE(0) / 0xffffffff;
}

/** No lugar do adapters/cloudWatchMetrics.js (mesma interface: `sums(queries, window)`). */
export class FakeCloudWatchMetrics {
  constructor({ log = console.log } = {}) {
    this._log = log;
  }

  async sums(queries, { start }) {
    const day = start.toISOString().slice(0, 10);
    const out = {};
    for (const q of queries) {
      const r = unit(`${day}:${q.id}`);
      if (q.id === 'apiRequests') out[q.id] = 200 + Math.round(r * 600);
      else if (q.id === 'api4xx') out[q.id] = Math.round(r * 12);
      else if (q.id === 'api5xx') out[q.id] = r > 0.8 ? 1 : 0;
      else if (q.functionName) out[q.id] = r > 0.985 ? 1 : 0;
      else out[q.id] = 0;
    }
    this._log('[cloudwatch simulado]', day, `${queries.length} metricas`);
    return out;
  }
}

/** Gasto diario inventado por servico (dolares), no lugar do adapters/costExplorer.js. */
const DAILY_USD = [
  ['Amazon DynamoDB', 0.004],
  ['AWS Lambda', 0],
  ['Amazon CloudFront', 0.006],
  ['Amazon Simple Storage Service', 0.003],
  ['AWS Cost Explorer', 0.01],
  ['Amazon Cognito', 0],
  ['AmazonCloudWatch', 0.001],
];

export class FakeCostExplorerCosts {
  constructor({ log = console.log } = {}) {
    this._log = log;
  }

  async byService({ start, end }) {
    const days = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 86400000));
    this._log('[cost explorer simulado]', `${start} a ${end}`);
    return {
      currency: 'USD',
      services: DAILY_USD.map(([service, perDay]) => ({ service, amount: Number((perDay * days).toFixed(4)) })),
    };
  }
}

/** No lugar da lib web-push: so registra o que seria enviado. */
export class FakeWebPush {
  constructor({ log = console.log } = {}) {
    this._log = log;
    this.sent = [];
  }

  async send(subscription, payload) {
    let host = 'endpoint invalido';
    try {
      host = new URL(subscription.endpoint).host;
    } catch {
      // segue com o texto padrao
    }
    this.sent.push({ endpoint: subscription.endpoint, payload });
    this._log('[web-push simulado]', host, JSON.stringify(payload));
    return { statusCode: 201 };
  }
}
