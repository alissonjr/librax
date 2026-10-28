import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Chip, type ChipTone } from './ui';
import { useApi } from '../lib/context';
import { fmtDay, fmtInt, fmtPct, fmtUsd } from '../lib/format';
import { feedbackKey, readKeys } from '../lib/feedbackRead';
import type { CostView, Overview } from '../lib/types';
import type { FeedbackItem } from '../lib/usageTypes';

/** Amostra mínima para uma lição entrar no aviso de desistência. */
const MIN_ABANDON_SAMPLE = 10;
/** Taxa de desistência que vira aviso. */
const ABANDON_ALERT = 0.3;
/** Fração do orçamento que já pede atenção. */
const BUDGET_WARN = 0.8;

export interface AttentionItem {
  key: string;
  tone: Extract<ChipTone, 'warn' | 'error'>;
  text: string;
  to: string;
}

/**
 * O que pede atenção, a partir do que o painel já carrega (sem rota nova): notas baixas ainda não
 * lidas, erros do servidor no último dia trazido do CloudWatch, custo previsto perto ou acima do
 * orçamento, a lição com mais desistência, letras e sinais difíceis na câmera e lembretes que falharam.
 */
export function attentionItems({ o, cost, feedback, read }: {
  o: Overview;
  cost: CostView | null;
  feedback: FeedbackItem[];
  read: Set<string>;
}): AttentionItem[] {
  const out: AttentionItem[] = [];

  const low = feedback.filter((f) => f.rating <= 2 && !read.has(feedbackKey(f)));
  if (low.length > 0) {
    out.push({
      key: 'notas',
      tone: 'warn',
      text: `${fmtInt(low.length)} ${low.length === 1 ? 'avaliação' : 'avaliações'} de 1 ou 2 estrelas ainda não ${low.length === 1 ? 'lida' : 'lidas'}`,
      to: '/uso',
    });
  }

  const lastDay = o.serverErrors.collectedThrough;
  const lastErrors = o.days.find((d) => d.day === lastDay)?.serverErrors ?? 0;
  if (lastDay && lastErrors > 0) {
    out.push({ key: 'erros', tone: 'error', text: `${fmtInt(lastErrors)} erros do servidor em ${fmtDay(lastDay)}`, to: '/' });
  }

  const m = cost?.latest;
  const budget = cost?.budgetUsd ?? null;
  if (m && budget && m.projectedTotal >= budget * BUDGET_WARN) {
    out.push({
      key: 'custo',
      tone: m.projectedTotal >= budget ? 'error' : 'warn',
      text: `Custo previsto do mês em ${fmtUsd(m.projectedTotal, m.currency)}, de um orçamento de ${fmtUsd(budget, m.currency)}`,
      to: '/custo',
    });
  }

  const worst = o.lessons
    .filter((l) => l.done + l.abandon >= MIN_ABANDON_SAMPLE && (l.abandonRate ?? 0) >= ABANDON_ALERT)
    .sort((a, b) => (b.abandonRate ?? 0) - (a.abandonRate ?? 0))[0];
  if (worst) {
    out.push({
      key: 'desistencia',
      tone: 'warn',
      text: `${worst.title ?? worst.lessonId}: ${fmtPct(worst.abandonRate)} saem no meio da lição`,
      to: '/',
    });
  }

  const hard = o.camera.signs.filter((s) => s.level === 'hard' && s.runs >= 5);
  if (hard.length > 0) {
    const names = hard.slice(0, 3).map((s) => s.gloss ?? s.signId).join(', ');
    out.push({
      key: 'camera',
      tone: 'warn',
      text: `${fmtInt(hard.length)} ${hard.length === 1 ? 'letra ou sinal difícil' : 'letras ou sinais difíceis'} na câmera (${names}${hard.length > 3 ? '...' : ''})`,
      to: '/camera',
    });
  }

  const failedWeek = o.days.slice(-7).reduce((a, d) => a + (d.remindersFailed ?? 0), 0);
  if (failedWeek > 0) {
    out.push({ key: 'lembretes', tone: 'warn', text: `${fmtInt(failedWeek)} lembretes falharam nos últimos 7 dias`, to: '/' });
  }

  return out;
}

/** Quadro do topo da Operação: o que pede atenção, ou uma linha dizendo que está tudo certo. */
export function Attention({ o }: { o: Overview }) {
  const api = useApi();
  const [extra, setExtra] = useState<{ cost: CostView | null; feedback: FeedbackItem[] } | null>(null);

  useEffect(() => {
    let alive = true;
    // Custo e notas são extras: se falharem, o quadro segue com o resto
    void Promise.all([
      api.cost().catch(() => null),
      api.feedback().then((p) => p.items).catch(() => [] as FeedbackItem[]),
    ]).then(([cost, feedback]) => {
      if (alive) setExtra({ cost, feedback });
    });
    return () => { alive = false; };
  }, [api]);

  if (!extra) {
    return (
      <Card title="O que pede atenção">
        <p className="state" role="status"><span className="spinner" aria-hidden="true" /> Conferindo...</p>
      </Card>
    );
  }
  const items = attentionItems({ o, cost: extra.cost, feedback: extra.feedback, read: readKeys() });
  return (
    <Card title="O que pede atenção">
      {items.length === 0 ? (
        <p className="attention-ok"><Chip tone="ok" icon="check_circle">Tudo certo</Chip> Nada fora do normal no período.</p>
      ) : (
        <ul className="attention" aria-label="O que pede atenção">
          {items.map((i) => (
            <li key={i.key}>
              <Chip tone={i.tone} icon="warning">{i.tone === 'error' ? 'Urgente' : 'Atenção'}</Chip>
              <Link to={i.to}>{i.text}</Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
