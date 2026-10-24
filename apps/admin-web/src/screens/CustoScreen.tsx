import { BarChart, RankList } from '../components/Chart';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad } from '../components/ui';
import { useApi } from '../lib/context';
import { fmtDateTime, fmtMonth, fmtUsd } from '../lib/format';
import type { CostView } from '../lib/types';

export function CustoScreen() {
  const api = useApi();
  const [load, reload] = useLoad(() => api.cost());
  return (
    <>
      <PageHeader title="Custo">Gasto na AWS, lido do Cost Explorer uma vez por dia (cada consulta custa US$ 0,01).</PageHeader>
      <Loaded load={load} onRetry={reload}>
        {(c) => <CustoView c={c} />}
      </Loaded>
    </>
  );
}

export function CustoView({ c }: { c: CostView }) {
  const m = c.latest;
  if (!m) {
    return (
      <Card>
        <p className="empty">
          Ainda sem custo guardado. O job diário (librax-ops-daily) traz o gasto às 00:30 de Brasília, e o Cost
          Explorer precisa estar ativado na conta.
        </p>
      </Card>
    );
  }
  const history = [...c.months].reverse();
  return (
    <div className="stack">
      <div className="stats">
        <StatTile
          label={m.complete ? `Total de ${fmtMonth(m.month)}` : `Estimado para ${fmtMonth(m.month)}`}
          value={fmtUsd(m.projectedTotal, m.currency)}
          hint={m.complete ? 'mês fechado' : `projeção de ${m.daysElapsed} de ${m.daysInMonth} dias`}
        />
        <StatTile label="Gasto até agora" value={fmtUsd(m.total, m.currency)} hint={`de ${m.start} até ${m.end} (exclusive)`} />
      </div>
      <Card
        title="Por serviço"
        actions={<Chip tone="info" icon="schedule">atualizado {fmtDateTime(m.asOf)}</Chip>}
      >
        <RankList
          rows={m.byService.map((s) => ({ key: s.service, label: s.service, value: s.amount, display: fmtUsd(s.amount, m.currency) }))}
          tone="neutral"
          label="Gasto por serviço"
          empty="Nenhum gasto no período (free tier)."
        />
        <p className="note">Custo sem rateio, já com créditos e reembolsos. Os dados do Cost Explorer chegam com até 24 h de atraso.</p>
      </Card>
      {history.length > 1 && (
        <Card title="Meses anteriores">
          <BarChart
            title="Total por mês"
            measure="Gasto (US$)"
            tone="neutral"
            height={120}
            format={(n) => fmtUsd(n, m.currency)}
            data={history.map((h) => ({ label: fmtMonth(h.month), value: h.complete ? h.total : h.projectedTotal }))}
          />
          <p className="note">O mês corrente aparece pela estimativa.</p>
        </Card>
      )}
    </div>
  );
}
