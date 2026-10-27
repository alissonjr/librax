import { useEffect, useState } from 'react';
import { BarChart, RankList } from '../components/Chart';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad } from '../components/ui';
import { useApi } from '../lib/context';
import { fmtDateTime, fmtDay, fmtDec, fmtInt, fmtMonth, fmtPct, fmtWeek } from '../lib/format';
import type { FeedbackItem, FunnelKey, Usage } from '../lib/usageTypes';
import './uso.css';

/*
 * Uso anônimo do app (GET /v1/admin/usage) e notas (GET /v1/admin/feedback): pessoas ativas com e sem
 * conta, retenção, funil, lições, até onde chegam no curso e as notas com os comentários. Tudo vem
 * de somas feitas na escrita, sem varrer a tabela, e nada aqui identifica uma pessoa.
 */

const FUNNEL_LABEL: Record<FunnelKey, string> = {
  app_open: 'Abriu o app',
  onboarding_done: 'Terminou as boas-vindas',
  first_lesson: 'Concluiu a 1a lição',
  five_lessons: 'Concluiu 5 lições',
  account_created: 'Criou ou entrou numa conta',
};
const PLATFORM_LABEL: Record<string, string> = { android: 'Android', ios: 'iPhone e iPad', desktop: 'Computador', other: 'Outro' };
const INSTALL_LABEL: Record<string, string> = { twa: 'app Android', pwa: 'instalado (PWA)', browser: 'navegador' };
const LANG_LABEL: Record<string, string> = { 'pt-BR': 'Português', en: 'Inglês', es: 'Espanhol' };

/** Amostra mínima para uma taxa entrar no ranking. */
const MIN_SAMPLE = 5;

const fmtDuration = (sec: number | null) => (sec == null ? '-' : sec < 60 ? `${sec} s` : `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, '0')} s`);

export function UsoScreen() {
  const api = useApi();
  const [load, reload] = useLoad(() => api.usage());
  return (
    <>
      <PageHeader title="Uso">
        Dados de uso anônimos do app, com e sem conta, nos últimos 30 dias. Servem para calibrar o algoritmo e os exercícios e não identificam ninguém.
      </PageHeader>
      <Loaded load={load} onRetry={reload}>
        {(u) => (
          <div className="stack">
            <UsoView u={u} />
            <FeedbackList />
          </div>
        )}
      </Loaded>
    </>
  );
}

export function UsoView({ u }: { u: Usage }) {
  const split = (s: { guest: number; account: number }) => `${fmtInt(s.guest)} sem conta, ${fmtInt(s.account)} com conta`;

  const opened = u.lessons
    .filter((l) => l.opens > 0)
    .slice(0, 10)
    .map((l) => ({
      key: l.lessonId,
      label: l.title ?? l.lessonId,
      detail: `${l.unitTitle ?? l.unitId ?? ''} · ${fmtPct(l.completionRate)} concluem · ${fmtDuration(l.avgDurationSec)} em média`,
      value: l.opens,
    }));
  const abandons = u.lessons
    .filter((l) => l.completes + l.abandons >= MIN_SAMPLE && l.abandons > 0)
    .sort((a, b) => (b.abandonRate ?? 0) - (a.abandonRate ?? 0) || b.abandons - a.abandons)
    .slice(0, 10);

  // Até onde chegam: por unidade, quantos códigos concluíram a primeira e a última lição dela
  const units: Array<{ unitId: string; unitTitle: string; first: number; last: number }> = [];
  for (const r of u.reach) {
    const key = r.unitId ?? '-';
    const unit = units.find((x) => x.unitId === key);
    if (!unit) units.push({ unitId: key, unitTitle: r.unitTitle ?? key, first: r.ids, last: r.ids });
    else unit.last = r.ids;
  }
  const started = units[0]?.first ?? 0;

  return (
    <>
      <div className="stats">
        <StatTile label="Ativas hoje" value={fmtInt(u.active.day.total)} hint={split(u.active.day)} />
        <StatTile label="Ativas na semana" value={fmtInt(u.active.week.total)} hint={split(u.active.week)} />
        <StatTile label="Ativas no mês" value={fmtInt(u.active.month.total)} hint={split(u.active.month)} />
        <StatTile label="Volta no dia seguinte (D1)" value={fmtPct(u.retention.d1.rate)} hint={`${fmtInt(u.retention.d1.returned)} de ${fmtInt(u.retention.d1.cohortSize)}`} />
        <StatTile label="Volta 7 dias depois (D7)" value={fmtPct(u.retention.d7.rate)} hint={`${fmtInt(u.retention.d7.returned)} de ${fmtInt(u.retention.d7.cohortSize)}`} />
        <StatTile label="Nota média do app" value={u.feedback.average == null ? '-' : fmtDec(u.feedback.average)} hint={`${fmtInt(u.feedback.count)} notas`} />
      </div>

      <Card title="Pessoas ativas">
        <div className="grid-2">
          <BarChart title="Sem conta, por dia" measure="Ativas sem conta" tone="hand" data={u.days.map((d) => ({ label: fmtDay(d.day), value: d.guest }))} />
          <BarChart title="Com conta, por dia" measure="Ativas com conta" tone="hand" data={u.days.map((d) => ({ label: fmtDay(d.day), value: d.account }))} />
        </div>
        <div className="grid-2">
          <BarChart title="Por semana" measure="Ativas" tone="hand" height={120} data={u.weeks.map((w) => ({ label: fmtWeek(w.week), value: w.guest + w.account }))} />
          <BarChart title="Por mês" measure="Ativas" tone="hand" height={120} data={u.months.map((m) => ({ label: fmtMonth(m.month), value: m.guest + m.account }))} />
        </div>
        <p className="note">Ativo: o app mandou algum evento naquele dia, semana ou mês. Cada aparelho tem o seu código anônimo, então a mesma pessoa em dois aparelhos conta duas vezes. Com conta ou sem conta é o que valia no momento.</p>
      </Card>

      <div className="grid-2">
        <Card title="Funil de quem começou do zero">
          <RankList
            rows={u.funnel.map((s) => ({ key: s.key, label: FUNNEL_LABEL[s.key] ?? s.key, detail: s.key === 'app_open' ? 'códigos novos com o app zerado' : `${fmtPct(s.rate)} de quem abriu`, value: s.count }))}
            tone="hand"
            label="Funil"
            empty="Ainda sem códigos novos no período."
          />
          <p className="note">Códigos que chegaram com o app zerado nos últimos 30 dias e quantos deles já passaram por cada etapa. Nada é enviado antes de terminar as boas-vindas, então quem desiste antes disso não aparece.</p>
        </Card>
        <Card title="Retenção por dia de chegada">
          {u.retention.cohorts.every((c) => c.size === 0) ? (
            <p className="empty">Ainda sem códigos novos no período.</p>
          ) : (
            <div className="table-wrap uso-scroll">
              <table className="table">
                <caption className="uso-sr-only">Retenção D1 e D7 por dia de chegada</caption>
                <thead>
                  <tr>
                    <th scope="col">Chegaram</th>
                    <th scope="col" className="num">Códigos</th>
                    <th scope="col" className="num">D1</th>
                    <th scope="col" className="num">D7</th>
                  </tr>
                </thead>
                <tbody>
                  {[...u.retention.cohorts].reverse().filter((c) => c.size > 0).map((c) => (
                    <tr key={c.day}>
                      <th scope="row">{fmtDay(c.day)}</th>
                      <td className="num">{fmtInt(c.size)}</td>
                      <td className="num">{c.d1 == null ? 'aguardando' : `${fmtPct(c.d1Rate)} (${fmtInt(c.d1)})`}</td>
                      <td className="num">{c.d7 == null ? 'aguardando' : `${fmtPct(c.d7Rate)} (${fmtInt(c.d7)})`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">D1: abriu o app no dia seguinte ao da chegada; D7: sete dias depois. Só quem chegou com o app zerado.</p>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Lições mais abertas">
          <RankList rows={opened} tone="trace" label="Lições mais abertas" empty="Nenhuma lição aberta no período." />
        </Card>
        <Card title="Onde as pessoas saem da lição">
          {abandons.length === 0 ? (
            <p className="empty">{`Nenhuma lição com ${MIN_SAMPLE} aberturas ou mais e alguma saída no meio.`}</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Lição</th>
                    <th scope="col" className="num">Saídas</th>
                    <th scope="col" className="num">Taxa</th>
                    <th scope="col">Saem mais no exercício</th>
                  </tr>
                </thead>
                <tbody>
                  {abandons.map((l) => (
                    <tr key={l.lessonId}>
                      <th scope="row">{l.title ?? l.lessonId}<span className="sub">{l.unitTitle ?? l.unitId ?? ''}</span></th>
                      <td className="num">{fmtInt(l.abandons)}</td>
                      <td className="num">{fmtPct(l.abandonRate)}</td>
                      <td>{l.abandonAt.map((a) => `${a.index + 1}º (${fmtInt(a.count)})`).join(', ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">Com e sem conta. Taxa = saídas / (saídas + conclusões).</p>
        </Card>
      </div>

      <Card title="Até onde chegam no curso">
        {started === 0 ? (
          <p className="empty">Nenhuma lição concluída ainda.</p>
        ) : (
          <RankList
            rows={units.map((x) => ({
              key: x.unitId,
              label: x.unitTitle,
              detail: `${fmtInt(x.first)} concluíram a 1a lição, ${fmtInt(x.last)} a última (${fmtPct(started > 0 ? x.last / started : null)} de quem começou o curso)`,
              value: x.last,
            }))}
            tone="trace"
            label="Unidades do curso"
            empty="Nenhuma lição concluída ainda."
          />
        )}
        <p className="note">Códigos que concluíram cada lição pelo menos uma vez, desde que os dados de uso começaram. Lições feitas antes disso não entram.</p>
      </Card>

      <div className="grid-2">
        <Card title="Como abrem o app">
          {u.platforms.length === 0 ? (
            <p className="empty">Ainda sem dado.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Aparelho</th>
                    <th scope="col">Como</th>
                    <th scope="col" className="num">Dias ativos</th>
                  </tr>
                </thead>
                <tbody>
                  {u.platforms.map((p) => (
                    <tr key={`${p.platform}:${p.installed}`}>
                      <th scope="row">{PLATFORM_LABEL[p.platform] ?? p.platform}</th>
                      <td>{INSTALL_LABEL[p.installed] ?? p.installed}</td>
                      <td className="num">{fmtInt(p.activeDays)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="note">Dia ativo: um código ativo num dia. Tirado no aparelho; o servidor não guarda o navegador.</p>
        </Card>
        <Card title="Boas-vindas e prática">
          <dl className="uso-facts">
            <dt>Idioma escolhido</dt>
            <dd>{u.onboarding.langs.map((l) => `${LANG_LABEL[l.lang] ?? l.lang} ${fmtInt(l.count)}`).join(', ') || '-'}</dd>
            <dt>Meta diária</dt>
            <dd>{u.onboarding.goals.map((g) => `${g.goal} XP: ${fmtInt(g.count)}`).join(', ') || '-'}</dd>
            <dt>Rodadas de prática</dt>
            <dd>{`${fmtInt(u.practice.review)} revisões, ${fmtInt(u.practice.free)} livres, ${fmtPct(u.practice.accuracy)} de acerto`}</dd>
            <dt>Teste de nivelamento</dt>
            <dd>{`${fmtInt(u.events.placement_started ?? 0)} começaram, ${fmtInt(u.events.placement_done ?? 0)} terminaram, ${fmtInt(u.placementPlaced)} lições puladas`}</dd>
            <dt>Meta do dia cumprida</dt>
            <dd>{fmtInt(u.events.daily_goal_met ?? 0)}</dd>
          </dl>
        </Card>
      </div>

      <Card title="Notas do app">
        <div className="grid-2">
          <RankList
            rows={[...u.feedback.distribution].reverse().map((d) => ({
              key: String(d.rating),
              label: `${d.rating} ${d.rating === 1 ? 'estrela' : 'estrelas'}`,
              value: d.count,
              display: `${fmtInt(d.count)} (${fmtPct(u.feedback.count ? d.count / u.feedback.count : null)})`,
            }))}
            tone="neutral"
            label="Notas por estrela"
            empty="Nenhuma nota ainda."
          />
          <BarChart
            title="Nota média por semana"
            measure="Nota média"
            tone="neutral"
            height={120}
            format={(n) => fmtDec(n)}
            data={u.weeks.map((w) => ({ label: fmtWeek(w.week), value: w.feedbackAverage }))}
          />
        </div>
        <BarChart title="Notas recebidas por dia" measure="Notas" tone="neutral" height={100} data={u.days.map((d) => ({ label: fmtDay(d.day), value: d.feedbackCount }))} />
        <p className="note">Uma nota por código anônimo: quem manda de novo troca a anterior. Barra vazada na média da semana: semana sem nota.</p>
      </Card>
    </>
  );
}

const RATING_FILTERS: Array<[string, string]> = [['', 'Todas'], ['5', '5 estrelas'], ['4', '4 estrelas'], ['3', '3 estrelas'], ['2', '2 estrelas'], ['1', '1 estrela']];

/** Comentários mais novos primeiro, paginados, com filtro por nota. O texto é sempre texto simples. */
export function FeedbackList() {
  const api = useApi();
  const [rating, setRating] = useState('');
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState('');

  async function load(from: string | null, filter = rating) {
    setState('loading');
    try {
      const page = await api.feedback({ rating: filter ? Number(filter) : null, cursor: from });
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.cursor);
      setState('idle');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }

  useEffect(() => {
    void load(null, rating);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating]);

  return (
    <Card title="Comentários">
      <div className="filters" role="group" aria-label="Filtro dos comentários">
        <label className="field">
          <span className="field-label">Nota</span>
          <select value={rating} onChange={(e) => setRating(e.target.value)}>
            {RATING_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      {items.length === 0 && state === 'idle' && <p className="empty">Nenhum comentário{rating ? ' com essa nota' : ''} ainda.</p>}
      {items.length > 0 && (
        <ol className="uso-comments" aria-label="Comentários, do mais novo para o mais velho">
          {items.map((f) => (
            <li key={`${f.at}-${f.rating}-${f.text.length}`} className="uso-comment">
              <div className="uso-comment-head">
                <Chip tone={f.rating >= 4 ? 'ok' : f.rating === 3 ? 'neutral' : 'warn'} icon="star">{`${f.rating} de 5`}</Chip>
                <span className="uso-comment-meta">
                  {[
                    fmtDateTime(f.at),
                    f.lessonsCompleted == null ? null : `${fmtInt(f.lessonsCompleted)} lições`,
                    f.platform ? `${PLATFORM_LABEL[f.platform] ?? f.platform}${f.installed ? ` (${INSTALL_LABEL[f.installed] ?? f.installed})` : ''}` : null,
                    f.lang ? LANG_LABEL[f.lang] ?? f.lang : null,
                    f.hasAccount ? 'com conta' : 'sem conta',
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>
              {/* texto simples: o React escapa tudo; nunca vira HTML */}
              {f.text ? <p className="uso-comment-text">{f.text}</p> : <p className="uso-comment-text uso-comment-text--empty">Sem comentário, só a nota.</p>}
            </li>
          ))}
        </ol>
      )}
      {state === 'loading' && <p className="state" role="status"><span className="spinner" aria-hidden="true" /> Carregando...</p>}
      {state === 'error' && (
        <div className="state state--error" role="alert">
          <Chip tone="error" icon="warning">Erro</Chip> {error}
          <button type="button" className="btn btn--secondary" onClick={() => void load(items.length ? cursor : null)}>Tentar de novo</button>
        </div>
      )}
      {state === 'idle' && cursor && (
        <button type="button" className="btn btn--secondary" onClick={() => void load(cursor)}>Carregar mais</button>
      )}
      <p className="note">As pessoas são avisadas para não escrever dados pessoais. Os comentários somem sozinhos 12 meses depois de enviados.</p>
    </Card>
  );
}
