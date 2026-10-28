import { useState } from 'react';
import { BarChart, RankList } from '../components/Chart';
import { Attention } from '../components/Attention';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad } from '../components/ui';
import { useApi } from '../lib/context';
import { EXERCISE_LABELS, fmtDay, fmtInt, fmtMonth, fmtPct, fmtWeek } from '../lib/format';
import type { Overview, OverviewDays } from '../lib/types';

const PERIODS: OverviewDays[] = [7, 30, 90];

/**
 * Variação contra o período anterior do mesmo tamanho: "+12% contra os 30 dias antes". Sem dado
 * antes (ou zero lá), não compara.
 */
export function versus(now: number, before: number | null | undefined, days: number): string | undefined {
  if (before == null || before <= 0) return undefined;
  const change = (now - before) / before;
  const pctText = `${change >= 0 ? '+' : '-'}${Math.round(Math.abs(change) * 100)}%`;
  return `${pctText} contra os ${days} dias antes`;
}

/** Amostra mínima para uma taxa entrar no ranking (menos que isso é ruído). */
const MIN_SAMPLE = 5;

export function OperacaoScreen() {
  const api = useApi();
  const [days, setDays] = useState<OverviewDays>(30);
  const [load, reload] = useLoad(() => api.overview(days), [days]);
  return (
    <>
      <PageHeader title="Operação">Pelos contadores agregados (sem varrer a tabela), comparando com o mesmo tanto de dias antes.</PageHeader>
      <div className="segmented period" role="radiogroup" aria-label="Período">
        {PERIODS.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={days === d}
            className={`segmented-item${days === d ? ' is-on' : ''}`}
            onClick={() => setDays(d)}
          >
            {d} dias
          </button>
        ))}
      </div>
      <Loaded load={load} onRetry={reload}>
        {(o) => (
          <div className="stack">
            <Attention o={o} />
            <OperacaoView o={o} />
          </div>
        )}
      </Loaded>
    </>
  );
}

export function OperacaoView({ o }: { o: Overview }) {
  const { totals } = o;
  const period = o.days.length;
  const prev = o.previous;
  const day = (field: 'activeUsers' | 'lessonsCompleted' | 'newAccounts') => o.days.map((d) => ({ label: fmtDay(d.day), value: d[field] }));

  const abandonRows = o.lessons
    .filter((l) => l.done + l.abandon >= MIN_SAMPLE && (l.abandonRate ?? 0) > 0)
    .sort((a, b) => (b.abandonRate ?? 0) - (a.abandonRate ?? 0))
    .slice(0, 8)
    .map((l) => ({
      key: l.lessonId,
      label: l.title ?? l.lessonId,
      detail: `${l.unitTitle ?? l.unitId ?? ''} · ${fmtInt(l.abandon)} saídas em ${fmtInt(l.done + l.abandon)} aberturas`,
      value: Math.round((l.abandonRate ?? 0) * 100),
      display: fmtPct(l.abandonRate),
    }));
  const wrongRows = o.lessons
    .filter((l) => l.attempted >= MIN_SAMPLE && (l.wrongRate ?? 0) > 0)
    .sort((a, b) => (b.wrongRate ?? 0) - (a.wrongRate ?? 0))
    .slice(0, 8)
    .map((l) => ({
      key: l.lessonId,
      label: l.title ?? l.lessonId,
      detail: `${l.unitTitle ?? l.unitId ?? ''} · ${fmtInt(l.wrong)} erros em ${fmtInt(l.attempted)} respostas`,
      value: Math.round((l.wrongRate ?? 0) * 100),
      display: fmtPct(l.wrongRate),
    }));

  const placementRows = o.lessons
    .filter((l) => (l.placementSkips ?? 0) > 0)
    .sort((a, b) => b.placementSkips - a.placementSkips || (a.lessonId < b.lessonId ? -1 : 1))
    .map((l) => ({
      key: l.lessonId,
      label: l.title ?? l.lessonId,
      detail: `${l.unitTitle ?? l.unitId ?? ''} · ${l.lessonId}${l.placementUndos ? ` · ${fmtInt(l.placementUndos)} desfeitas` : ''}`,
      value: l.placementSkips,
    }));

  return (
    <div className="stack">
      <div className="stats">
        <StatTile label="Ativas hoje" value={fmtInt(totals.activeToday)} hint={fmtDay(o.today)} />
        <StatTile label="Ativas na semana" value={fmtInt(totals.activeWeek)} />
        <StatTile label="Ativas no mês" value={fmtInt(totals.activeMonth)} />
        <StatTile
          label="Ativas por dia, em média"
          value={fmtInt(Math.round(totals.activeAvg ?? 0))}
          hint={versus(totals.activeAvg ?? 0, prev?.activeAvg, period) ?? `${period} dias`}
        />
        <StatTile label="Contas novas" value={fmtInt(totals.newAccounts)} hint={versus(totals.newAccounts, prev?.newAccounts, period) ?? `${period} dias`} />
        <StatTile label="Lições concluídas" value={fmtInt(totals.lessonsCompleted)} hint={versus(totals.lessonsCompleted, prev?.lessonsCompleted, period) ?? `${period} dias`} />
        <StatTile label="Erros do servidor" value={fmtInt(totals.serverErrors)} hint={o.serverErrors.collectedThrough ? `até ${fmtDay(o.serverErrors.collectedThrough)}` : 'sem dado ainda'} />
      </div>

      <Card title="Pessoas ativas">
        <BarChart title="Por dia" measure="Pessoas ativas" tone="hand" data={day('activeUsers')} />
        <div className="grid-2">
          <BarChart title="Por semana" measure="Pessoas ativas" tone="hand" height={120} data={o.weeks.map((w) => ({ label: fmtWeek(w.week), value: w.activeUsers }))} />
          <BarChart title="Por mês" measure="Pessoas ativas" tone="hand" height={120} data={o.months.map((m) => ({ label: fmtMonth(m.month), value: m.activeUsers }))} />
        </div>
        <p className="note">Ativa: concluiu lição, fez a prática do dia ou abriu uma lição, contada uma vez por dia, semana e mês. Só contas (o convidado fica no aparelho).</p>
      </Card>

      <div className="grid-2">
        <Card title="Lições concluídas">
          <BarChart title="Por dia" measure="Lições concluídas" tone="trace" data={day('lessonsCompleted')} />
        </Card>
        <Card title="Contas novas">
          <BarChart title="Por dia" measure="Contas novas" tone="hand" data={day('newAccounts')} />
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Onde as pessoas desistem">
          <RankList rows={abandonRows} tone="error" label="Lições com mais saídas no meio" empty={`Nenhuma lição com ${MIN_SAMPLE} aberturas ou mais e alguma saída no meio.`} />
          <p className="note">Saída: confirmou "Sair da lição?". Taxa = saídas / (saídas + conclusões).</p>
        </Card>
        <Card title="Onde as pessoas mais erram">
          <RankList rows={wrongRows} tone="error" label="Lições com mais erros" empty={`Nenhuma lição com ${MIN_SAMPLE} respostas ou mais e algum erro.`} />
          <p className="note">Taxa = respostas erradas / respostas, por lição.</p>
        </Card>
      </div>

      <Card title="Puladas pelo nivelamento">
        <RankList rows={placementRows} tone="trace" label="Lições puladas pelo nivelamento" empty="Nenhuma lição pulada pelo teste de nivelamento no período." />
        <p className="note">Vezes em que a lição foi pulada pelo teste de nivelamento (sem XP, sequência nem conquista). Desfeitas: a pessoa desfez o teste em Configurações antes de refazer a lição.</p>
      </Card>

      <div className="grid-2">
        <Card title="Por tipo de exercício">
          {o.exercises.length === 0 ? (
            <p className="empty">Ainda sem respostas por tipo de exercício.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Exercício</th>
                    <th scope="col" className="num">Respostas</th>
                    <th scope="col" className="num">Erros</th>
                    <th scope="col" className="num">Taxa de erro</th>
                    <th scope="col" className="num">Saídas</th>
                  </tr>
                </thead>
                <tbody>
                  {o.exercises.map((e) => (
                    <tr key={e.type}>
                      <th scope="row">{EXERCISE_LABELS[e.type] ?? e.type}</th>
                      <td className="num">{fmtInt(e.attempted)}</td>
                      <td className="num">{fmtInt(e.wrong)}</td>
                      <td className="num">{fmtPct(e.wrongRate)}</td>
                      <td className="num">{fmtInt(e.abandon)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Sinais com mais erros">
          <RankList
            rows={o.signs.slice(0, 10).map((s) => ({ key: s.signId, label: s.gloss ?? s.signId, detail: s.signId, value: s.failed }))}
            tone="error"
            label="Sinais mais errados"
            empty="Nenhum sinal errado no período."
          />
        </Card>
      </div>

      <Card title="Lembretes">
        <div className="stats">
          <StatTile
            label="Com lembrete ligado"
            value={o.reminders ? fmtInt(o.reminders.enabled) : '-'}
            hint={o.reminders ? `${fmtInt(o.reminders.email)} com e-mail, em ${fmtDay(o.reminders.day)}` : 'o job diário ainda não contou'}
          />
          <StatTile label="Lembretes enviados" value={fmtInt(totals.remindersSent ?? 0)} hint={`${period} dias, notificação e e-mail`} />
          <StatTile label="Falhas no envio" value={fmtInt(totals.remindersFailed ?? 0)} hint={`${period} dias`} />
        </div>
        <BarChart
          title="Enviados por dia"
          measure="Lembretes enviados"
          tone="trace"
          data={o.days.map((d) => ({ label: fmtDay(d.day), value: (d.remindersPush ?? 0) + (d.remindersEmail ?? 0) }))}
        />
        <p className="note">Lembrete ligado: a pessoa escolheu um horário em Configurações. A contagem sai uma vez por dia; os enviados contam notificações entregues e e-mails, e as falhas, os envios que deram erro (inscrição vencida não conta: ela é apagada).</p>
      </Card>

      <Card
        title="Erros do servidor"
        actions={o.serverErrors.collectedThrough
          ? <Chip tone="info" icon="schedule">CloudWatch até {fmtDay(o.serverErrors.collectedThrough)}</Chip>
          : <Chip tone="warn" icon="schedule">Job diário ainda não rodou</Chip>}
      >
        <BarChart title="5xx da API + erros das Lambdas, por dia" measure="Erros" tone="error" data={o.days.map((d) => ({ label: fmtDay(d.day), value: d.serverErrors }))} />
        <RankList
          rows={o.serverErrors.byFunction.map((f) => ({ key: f.name, label: f.name, value: f.errors }))}
          tone="error"
          label="Erros por Lambda"
          empty="Nenhuma Lambda com erro no período."
        />
        <p className="note">Trazido do CloudWatch uma vez por dia (00:30 em Brasília). Para o que acontece agora, os alarmes avisam por e-mail.</p>
      </Card>
    </div>
  );
}
