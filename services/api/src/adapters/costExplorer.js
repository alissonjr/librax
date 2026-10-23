/**
 * Custo por servico no Cost Explorer (job diario do painel, tela Custo).
 *
 * Cada GetCostAndUsage custa US$ 0,01: o job chama uma vez por dia e guarda o resultado na
 * tabela; a tela nunca chama o Cost Explorer. O endpoint do Cost Explorer fica em us-east-1, qualquer
 * que seja a regiao da stack.
 *
 * Requer `ce:GetCostAndUsage` (o recurso e sempre `*`) e o Cost Explorer ativado na conta (uma vez,
 * pelo console de Billing).
 */

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';

export function makeCostExplorerClient(options = {}) {
  return new CostExplorerClient({ region: 'us-east-1', ...options });
}

export class CostExplorerCosts {
  /** @param {{send: Function}} client CostExplorerClient (ou um falso nos testes) */
  constructor(client) {
    this._client = client;
  }

  /**
   * Gasto (UnblendedCost, ja com creditos e reembolsos) por servico entre `start` e `end`
   * ('YYYY-MM-DD', fim exclusivo).
   * @returns {Promise<{currency: string, services: Array<{service: string, amount: number}>}>}
   */
  async byService({ start, end }) {
    const totals = new Map();
    let currency = 'USD';
    let NextPageToken;
    do {
      const res = await this._client.send(
        new GetCostAndUsageCommand({
          TimePeriod: { Start: start, End: end },
          Granularity: 'MONTHLY',
          Metrics: ['UnblendedCost'],
          GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
          NextPageToken,
        }),
      );
      for (const period of res.ResultsByTime ?? []) {
        for (const group of period.Groups ?? []) {
          const metric = group.Metrics?.UnblendedCost;
          const service = group.Keys?.[0] ?? 'Outros';
          totals.set(service, (totals.get(service) ?? 0) + Number(metric?.Amount ?? 0));
          if (metric?.Unit) currency = metric.Unit;
        }
      }
      NextPageToken = res.NextPageToken;
    } while (NextPageToken);
    return { currency, services: [...totals].map(([service, amount]) => ({ service, amount })) };
  }
}
