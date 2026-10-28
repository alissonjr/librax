import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad } from '../components/ui';
import { Icon } from '../components/Icon';
import { useApi } from '../lib/context';
import { fmtDate, fmtDay, fmtInt, fmtPct } from '../lib/format';
import { ApiError } from '../lib/api';
import type { Account, AccountSummary } from '../lib/types';

/** Contas por página (o padrão da rota: services/api/src/handlers/admin.js). */
const ACCOUNTS_PER_PAGE = 25;

const TIERS: Record<string, string> = {
  bronze: 'Bronze', prata: 'Prata', ouro: 'Ouro', safira: 'Safira', rubi: 'Rubi', ametista: 'Ametista', diamante: 'Diamante',
};

export function ContasScreen() {
  const api = useApi();
  const [q, setQ] = useState('');
  /** Termo da busca em vigor; null = listagem de todas as contas. */
  const [searched, setSearched] = useState<string | null>(null);
  const [results, setResults] = useState<Account[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'list' | 'search' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Listagem: o Cognito só anda para a frente (PaginationToken), então guardamos o cursor de cada
  // página já vista para o "Anterior". pages[i] = cursor que abre a página i (a primeira é null).
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const [next, setNext] = useState<string | null>(null);

  async function loadPage(index: number, cursor: string | null) {
    setError(null);
    setSelected(null);
    setBusy('list');
    try {
      const res = await api.listAccounts(cursor);
      setResults(res.accounts);
      setNext(res.cursor);
      setPage(index);
      setPages((prev) => [...prev.slice(0, index), cursor]);
      setSearched(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Com a página cheia, o resumo abre longe da conta clicada: rola até ele
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [selected]);

  useEffect(() => {
    void loadPage(0, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e: FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) {
      await loadPage(0, null);
      return;
    }
    setError(null);
    setSelected(null);
    setBusy('search');
    try {
      setResults((await api.searchAccounts(term)).accounts);
      setSearched(term);
    } catch (err) {
      setResults(null);
      setError(err instanceof ApiError && err.status === 400 ? 'Digite pelo menos 3 letras do e-mail ou o id da conta.' : (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function clearSearch() {
    setQ('');
    void loadPage(0, null);
  }

  return (
    <>
      <PageHeader title="Contas">
        Todas as contas, {ACCOUNTS_PER_PAGE} por página, na ordem do Cognito. Para achar uma conta, busque pelo começo do
        e-mail ou pelo id (sub do Cognito). Só leitura.
      </PageHeader>
      <div className="stack">
        <Card>
          <form className="search" role="search" onSubmit={search}>
            <label className="field field--grow">
              <span className="field-label">E-mail ou id</span>
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ana@exemplo.com" autoComplete="off" />
            </label>
            <button type="submit" className="btn btn--primary" disabled={busy !== null}>
              <Icon name="visibility" /> {busy === 'search' ? 'Buscando...' : 'Buscar'}
            </button>
          </form>
          {busy === 'list' && !results && <p className="state" role="status"><span className="spinner" aria-hidden="true" /> Carregando...</p>}
          {error && <p className="state state--error" role="alert"><Chip tone="error" icon="warning">Erro</Chip> {error}</p>}
          {searched !== null && (
            <p className="count" role="status">
              Busca por "{searched}": {fmtInt(results?.length ?? 0)} {results?.length === 1 ? 'conta' : 'contas'}.{' '}
              <button type="button" className="btn btn--secondary" onClick={clearSearch} disabled={busy !== null}>Ver todas as contas</button>
            </p>
          )}
          {results && results.length === 0 && <p className="empty">{searched !== null ? 'Nenhuma conta encontrada.' : 'Nenhuma conta criada ainda.'}</p>}
          {results && results.length > 0 && (
            <ul className="results" aria-label={searched !== null ? 'Contas encontradas' : 'Contas'}>
              {results.map((a) => (
                <li key={a.userId ?? a.email}>
                  <button
                    type="button"
                    className={`result${selected === a.userId ? ' is-on' : ''}`}
                    aria-pressed={selected === a.userId}
                    onClick={() => setSelected(a.userId)}
                  >
                    <span className="result-main">{a.email ?? a.userId}</span>
                    <span className="result-sub">{providerLabel(a.provider)}, desde {fmtDate(a.createdAt)}</span>
                    {!a.enabled && <Chip tone="error" icon="lock">desativada</Chip>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searched === null && results && (page > 0 || next) && (
            <nav className="pager" aria-label="Páginas de contas">
              <button type="button" className="btn btn--secondary" disabled={busy !== null || page === 0} onClick={() => void loadPage(page - 1, pages[page - 1] ?? null)}>
                Anterior
              </button>
              <span className="count" role="status">Página {fmtInt(page + 1)}</span>
              <button type="button" className="btn btn--secondary" disabled={busy !== null || !next} onClick={() => void loadPage(page + 1, next)}>
                Próxima
              </button>
            </nav>
          )}
        </Card>
        {selected && <div ref={detailRef}><AccountDetail key={selected} userId={selected} /></div>}
      </div>
    </>
  );
}

const OUTCOME: Record<string, string> = { promoted: 'subiu', relegated: 'desceu', stayed: 'ficou' };

function providerLabel(p: string) {
  return p === 'email' ? 'e-mail e senha' : p;
}

function AccountDetail({ userId }: { userId: string }) {
  const api = useApi();
  const [load, reload] = useLoad(() => api.account(userId), [userId]);
  return (
    <Loaded load={load} onRetry={reload}>
      {(s) => <AccountView s={s} />}
    </Loaded>
  );
}

export function AccountView({ s }: { s: AccountSummary }) {
  const p = s.profile;
  return (
    <div className="stack" aria-label="Resumo da conta">
      <Card title={s.account?.email ?? s.userId} actions={s.account?.emailVerified ? <Chip tone="ok" icon="check">e-mail verificado</Chip> : <Chip tone="neutral" icon="mail">e-mail não verificado</Chip>}>
        <dl className="facts">
          <div><dt>Id</dt><dd className="mono">{s.userId}</dd></div>
          <div><dt>Entrada</dt><dd>{s.account ? providerLabel(s.account.provider) : '-'}</dd></div>
          <div><dt>Conta criada</dt><dd>{fmtDate(s.account?.createdAt)}</dd></div>
          <div><dt>Nome no app</dt><dd>{p?.displayName ?? '-'}</dd></div>
          <div><dt>Fuso</dt><dd>{p?.timezone ?? '-'}</dd></div>
          <div><dt>Última atividade</dt><dd>{s.activity?.lastDay ? fmtDay(s.activity.lastDay) : p?.lastActiveDay ? fmtDay(p.lastActiveDay) : '-'}</dd></div>
        </dl>
      </Card>

      {p ? (
        <div className="stats">
          <StatTile label="XP" value={fmtInt(p.xpTotal)} />
          <StatTile label="Ofensiva" value={`${fmtInt(p.streak)} dias`} hint={`${fmtInt(p.freezes)} ${p.freezes === 1 ? 'proteção' : 'proteções'}`} />
          <StatTile
            label="Lições"
            value={fmtInt(s.progress.distinctLessons)}
            hint={[
              s.progress.totalLessons ? `de ${fmtInt(s.progress.totalLessons)}` : '',
              s.progress.placementSkipped ? `${fmtInt(s.progress.placementSkipped)} pulada${s.progress.placementSkipped === 1 ? '' : 's'} pelo nivelamento` : '',
            ].filter(Boolean).join(', ') || undefined}
          />
          <StatTile label="Sinais aprendidos" value={fmtInt(p.signsLearned)} hint={`${fmtInt(s.srs.signs)} na revisão, ${fmtInt(s.srs.due)} para hoje`} />
          <StatTile label="Conquistas" value={fmtInt(s.achievements.length)} />
        </div>
      ) : (
        <Card><p className="empty">Conta criada, mas ainda sem progresso no servidor.</p></Card>
      )}

      <div className="grid-2">
        <Card title="Liga">
          <dl className="facts">
            <div><dt>Liga atual</dt><dd>{s.league.tier ? TIERS[s.league.tier] ?? s.league.tier : 'Bronze (ainda não entrou)'}</dd></div>
            <div><dt>Semana</dt><dd>{s.league.current ? `${s.league.current.leagueId}, ${fmtInt(s.league.current.xpPeriod)} XP` : 'sem liga nesta semana'}</dd></div>
            <div>
              <dt>Último resultado</dt>
              <dd>{lastResult(s.league.lastResult)}</dd>
            </div>
          </dl>
        </Card>
        <Card title="Squads">
          {s.squads.length === 0 ? <p className="empty">Não participa de squad.</p> : (
            <ul className="list">
              {s.squads.map((q) => (
                <li key={q.squadId}>
                  <span>{q.name ?? q.squadId}</span>
                  <span className="chips">
                    <Chip tone="neutral" icon="group">{fmtInt(q.memberCount)} membros</Chip>
                    {q.role === 'admin' && <Chip tone="info" icon="shield">admin</Chip>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Progresso">
        {s.progress.lessons.length === 0 ? <p className="empty">Nenhuma lição concluída.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Lição</th><th scope="col">Unidade</th><th scope="col">Situação</th><th scope="col" className="num">Melhor nota</th><th scope="col">Data</th></tr>
              </thead>
              <tbody>
                {s.progress.lessons.map((l) => (
                  <tr key={l.lessonId}>
                    <th scope="row">{l.title ?? l.lessonId}<span className="sub">{l.lessonId}</span></th>
                    <td>{l.unitId?.toUpperCase() ?? '-'}</td>
                    <td>{l.status === 'placement'
                      ? <Chip tone="neutral" icon="skip_next">pulada pelo nivelamento</Chip>
                      : l.status === 'completed' ? 'concluída' : (l.status ?? '-')}</td>
                    <td className="num">{l.status === 'placement' ? '-' : fmtPct(l.bestScore)}</td>
                    <td>{(l.completedAt ?? l.skippedAt) ? fmtDay((l.completedAt ?? l.skippedAt) as string) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function lastResult(r: AccountSummary['league']['lastResult']): string {
  if (!r) return '-';
  const outcome = r.outcome ? OUTCOME[r.outcome] ?? r.outcome : '';
  const tier = r.toTier ? ` para ${TIERS[r.toTier] ?? r.toTier}` : '';
  const rank = r.rank ? ` (${r.rank}º de ${r.total})` : '';
  return `${outcome}${tier}${rank}`.trim() || '-';
}
