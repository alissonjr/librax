import { test } from 'node:test';
import assert from 'node:assert/strict';

import { costWindow, buildCostReport } from '../src/domain/costReport.js';
import { opsDayWindow, cloudMetricQueries } from '../src/usecases/collectDailyOps.js';
import { makeOpsDailyHandler } from '../src/handlers/opsDaily.js';
import { CloudWatchMetrics } from '../src/adapters/cloudWatchMetrics.js';
import { CostExplorerCosts } from '../src/adapters/costExplorer.js';
import { InMemoryRepo } from '../src/adapters/inMemoryRepo.js';

// Job diario do painel: CloudWatch e Cost Explorer uma vez por dia, guardados na tabela. A tela
// so le a tabela (o Cost Explorer cobra US$ 0,01 por chamada).

const config = { apiId: 'abc123', stage: 'api', functionNames: ['librax-complete-lesson', 'librax-admin'], tableName: 'librax' };

function fakeCloud(sums = {}) {
  const calls = [];
  return {
    calls,
    async sums(queries, window) {
      calls.push({ queries, window });
      return Object.fromEntries(queries.map((q) => [q.id, sums[q.id] ?? 0]));
    },
  };
}
function fakeCosts(services = [], { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async byService(range) {
      calls.push(range);
      if (fail) throw new Error('Cost Explorer nao ativado');
      return { currency: 'USD', services };
    },
  };
}
const quiet = async (fn) => {
  const log = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = log;
  }
};

// --- dominio do custo ---

test('costWindow: do dia 1 do mes ate hoje (fim exclusivo)', () => {
  assert.deepEqual(costWindow(new Date('2026-10-23T03:30:00Z')), {
    month: '2026-10', start: '2026-10-01', end: '2026-10-23', complete: false, daysElapsed: 22, daysInMonth: 31,
  });
});

test('costWindow: no dia 1 fecha o mes anterior inteiro', () => {
  assert.deepEqual(costWindow(new Date('2026-11-01T03:30:00Z')), {
    month: '2026-10', start: '2026-10-01', end: '2026-11-01', complete: true, daysElapsed: 31, daysInMonth: 31,
  });
  assert.equal(costWindow(new Date('2027-01-01T03:30:00Z')).month, '2026-12');
});

test('buildCostReport: total, servicos em ordem e projecao linear do mes', () => {
  const r = buildCostReport(
    { month: '2026-10', start: '2026-10-01', end: '2026-10-11', complete: false, daysElapsed: 10, daysInMonth: 31 },
    [{ service: 'AWS Lambda', amount: 0.104 }, { service: 'Amazon DynamoDB', amount: 0.9 }, { service: 'Tax', amount: 0 }],
    { asOf: '2026-10-11T03:30:00.000Z' },
  );
  assert.equal(r.total, 1);
  assert.equal(r.projectedTotal, 3.1);
  assert.deepEqual(r.byService, [{ service: 'Amazon DynamoDB', amount: 0.9 }, { service: 'AWS Lambda', amount: 0.1 }]);
  assert.equal(r.currency, 'USD');
});

// --- janela e consultas do CloudWatch ---

test('o dia do painel e o de Brasilia: 03:00 a 03:00 UTC', () => {
  const { start, end } = opsDayWindow('2026-10-22');
  assert.equal(start.toISOString(), '2026-10-22T03:00:00.000Z');
  assert.equal(end.toISOString(), '2026-10-23T03:00:00.000Z');
});

test('consultas: 5xx e 4xx da API, erros por Lambda e throttling', () => {
  const q = cloudMetricQueries(config);
  const ids = q.map((x) => x.id);
  assert.deepEqual(ids, ['api5xx', 'api4xx', 'apiRequests', 'lambdaThrottles', 'ddbReadThrottles', 'ddbWriteThrottles', 'fn0', 'fn1']);
  for (const id of ids) assert.match(id, /^[a-z][a-zA-Z0-9_]*$/); // formato exigido pelo GetMetricData
  assert.deepEqual(q[0].dimensions, { ApiId: 'abc123', Stage: 'api' });
  assert.deepEqual(q[6].dimensions, { FunctionName: 'librax-complete-lesson' });
});

// --- handler ---

test('job grava os erros de ontem e o custo do mes; a tela le so a tabela', async () => {
  const repo = new InMemoryRepo();
  const cloud = fakeCloud({ api5xx: 4, api4xx: 30, apiRequests: 900, fn1: 2, ddbWriteThrottles: 1 });
  const costs = fakeCosts([{ service: 'Amazon CloudFront', amount: 0.4 }, { service: 'AWS Lambda', amount: 0.2 }]);
  const { handler } = makeOpsDailyHandler({ repo, cloud, costs, config, now: () => new Date('2026-10-23T03:30:00Z') });

  const report = await quiet(() => handler({}));
  assert.equal(report.day, '2026-10-22');
  assert.equal(cloud.calls[0].window.start.toISOString(), '2026-10-22T03:00:00.000Z');
  const day = await repo.getOpsItem('DAY#2026-10-22');
  assert.deepEqual(day.cloud, {
    api5xx: 4, api4xx: 30, apiRequests: 900, lambdaErrors: 2, lambdaThrottles: 0, ddbThrottles: 1,
    errorsByFunction: { 'librax-admin': 2 }, collectedAt: '2026-10-23T03:30:00.000Z',
  });
  assert.deepEqual(costs.calls, [{ start: '2026-10-01', end: '2026-10-23' }]);
  const cost = await repo.getOpsItem('COST#2026-10');
  assert.equal(cost.total, 0.6);
  assert.equal(cost.byService[0].service, 'Amazon CloudFront');
});

test('rodar de novo no mesmo dia regrava (sem somar) e preserva os contadores do dia', async () => {
  const repo = new InMemoryRepo();
  await repo.addOpsCounters('DAY#2026-10-22', { activeUsers: 7 });
  const { handler } = makeOpsDailyHandler({
    repo, cloud: fakeCloud({ api5xx: 1 }), costs: fakeCosts(), config, now: () => new Date('2026-10-23T03:30:00Z'),
  });
  await quiet(() => handler({}));
  await quiet(() => handler({}));
  const day = await repo.getOpsItem('DAY#2026-10-22');
  assert.equal(day.cloud.api5xx, 1);
  assert.equal(day.activeUsers, 7);
});

test('dia manual e skipCost: refaz um dia sem pagar o Cost Explorer', async () => {
  const repo = new InMemoryRepo();
  const costs = fakeCosts();
  const { handler } = makeOpsDailyHandler({ repo, cloud: fakeCloud(), costs, config, now: () => new Date('2026-10-23T03:30:00Z') });
  const report = await quiet(() => handler({ day: '2026-10-10', skipCost: true }));
  assert.equal(report.day, '2026-10-10');
  assert.equal(costs.calls.length, 0);
  assert.ok(await repo.getOpsItem('DAY#2026-10-10'));
});

test('Cost Explorer fora: os erros do dia sao gravados e o job falha (alarme de erro)', async () => {
  const repo = new InMemoryRepo();
  const { handler } = makeOpsDailyHandler({
    repo, cloud: fakeCloud({ api5xx: 2 }), costs: fakeCosts([], { fail: true }), config, now: () => new Date('2026-10-23T03:30:00Z'),
  });
  await assert.rejects(() => quiet(() => handler({})), /Cost Explorer/);
  assert.equal((await repo.getOpsItem('DAY#2026-10-22')).cloud.api5xx, 2);
});

// --- adaptadores ---

test('CloudWatchMetrics soma os pontos de 1 h e segue o NextToken', async () => {
  const calls = [];
  const client = {
    async send(cmd) {
      calls.push(cmd.input);
      if (!cmd.input.NextToken) return { MetricDataResults: [{ Id: 'api5xx', Values: [1, 2] }], NextToken: 't1' };
      return { MetricDataResults: [{ Id: 'api5xx', Values: [3] }, { Id: 'fn0', Values: [] }] };
    },
  };
  const window = opsDayWindow('2026-10-22');
  const sums = await new CloudWatchMetrics(client).sums(cloudMetricQueries(config), window);
  assert.equal(sums.api5xx, 6);
  assert.equal(sums.fn0, 0);
  assert.equal(calls.length, 2);
  const [first] = calls[0].MetricDataQueries;
  assert.equal(first.MetricStat.Period, 3600);
  assert.equal(first.MetricStat.Stat, 'Sum');
  assert.deepEqual(first.MetricStat.Metric.Dimensions, [{ Name: 'ApiId', Value: 'abc123' }, { Name: 'Stage', Value: 'api' }]);
});

test('CostExplorerCosts agrupa por servico com UnblendedCost', async () => {
  const calls = [];
  const client = {
    async send(cmd) {
      calls.push(cmd.input);
      return {
        ResultsByTime: [{
          Groups: [
            { Keys: ['Amazon DynamoDB'], Metrics: { UnblendedCost: { Amount: '0.1234', Unit: 'USD' } } },
            { Keys: ['AWS Lambda'], Metrics: { UnblendedCost: { Amount: '0.02', Unit: 'USD' } } },
          ],
        }],
      };
    },
  };
  const r = await new CostExplorerCosts(client).byService({ start: '2026-10-01', end: '2026-10-23' });
  assert.deepEqual(r, { currency: 'USD', services: [{ service: 'Amazon DynamoDB', amount: 0.1234 }, { service: 'AWS Lambda', amount: 0.02 }] });
  assert.equal(calls.length, 1); // uma chamada por dia (US$ 0,01)
  assert.deepEqual(calls[0].GroupBy, [{ Type: 'DIMENSION', Key: 'SERVICE' }]);
  assert.deepEqual(calls[0].TimePeriod, { Start: '2026-10-01', End: '2026-10-23' });
});
