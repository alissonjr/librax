import { useEffect, useMemo, useState } from 'react';
import { Meter } from '../components/Chart';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad } from '../components/ui';
import { useApi } from '../lib/context';
import { MISSING_LABELS, fmtInt, fmtPct } from '../lib/format';
import type { ContentStatus, Missing, SignStatus } from '../lib/types';

export function ConteudoScreen() {
  const api = useApi();
  const [load, reload] = useLoad(() => api.content());
  return (
    <>
      <PageHeader title="Conteúdo">O que o curso tem no bundle do app e o que falta em cada sinal.</PageHeader>
      <Loaded load={load} onRetry={reload}>
        {(c) => <ConteudoView c={c} />}
      </Loaded>
    </>
  );
}

type Filter = 'all' | Missing | 'complete';
/** Linhas por vez na tabela de sinais (são 254). */
export const PAGE_SIZE = 40;
const FILTERS: Array<[Filter, string]> = [
  ['all', 'Todos'],
  ['validated', 'Sem validação'],
  ['video', 'Sem vídeo'],
  ['source', 'Sem fonte'],
  ['avatar', 'Sem avatar'],
  ['complete', 'Completos'],
];

function matches(s: SignStatus, filter: Filter, unit: string, text: string) {
  if (unit && s.unitId !== unit) return false;
  if (filter === 'complete' && s.missing.length > 0) return false;
  if (filter !== 'all' && filter !== 'complete' && !s.missing.includes(filter)) return false;
  if (text) {
    const t = text.toLowerCase();
    if (!s.gloss.toLowerCase().includes(t) && !s.id.toLowerCase().includes(t)) return false;
  }
  return true;
}

export function ConteudoView({ c }: { c: ContentStatus }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [unit, setUnit] = useState('');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const rows = useMemo(() => c.signs.filter((s) => matches(s, filter, unit, text)), [c.signs, filter, unit, text]);
  // filtro novo volta para a primeira página
  useEffect(() => setShown(PAGE_SIZE), [filter, unit, text]);
  const unitTitle = Object.fromEntries(c.units.map((u) => [u.id, u.title]));
  const t = c.totals;

  return (
    <div className="stack">
      <div className="stats">
        <StatTile label="Unidades" value={fmtInt(t.units)} hint={`${fmtInt(t.lessons)} lições`} />
        <StatTile label="Sinais" value={fmtInt(t.signs)} />
        <StatTile label="Validados" value={fmtInt(t.validated)} hint={fmtPct(t.signs ? t.validated / t.signs : null)} />
        <StatTile label="Com vídeo" value={fmtInt(t.withVideo)} hint={fmtPct(t.signs ? t.withVideo / t.signs : null)} />
        <StatTile label="Com avatar" value={fmtInt(t.withAvatar)} hint={fmtPct(t.signs ? t.withAvatar / t.signs : null)} />
        <StatTile label="Com fonte" value={fmtInt(t.withSource)} hint={fmtPct(t.signs ? t.withSource / t.signs : null)} />
      </div>

      <Card title="Unidades">
        <ul className="units">
          {c.units.map((u) => (
            <li key={u.id} className="unit">
              <div className="unit-head">
                <span className="unit-id">{u.id.toUpperCase()}</span>
                <span className="unit-title">{u.title}</span>
                {u.validated === u.signs
                  ? <Chip tone="ok" icon="check">validada</Chip>
                  : <Chip tone="warn" icon="info">rascunho</Chip>}
              </div>
              <span className="unit-meta">{fmtInt(u.lessons.length)} lições, {fmtInt(u.signs)} sinais</span>
              <dl className="unit-bars">
                {([
                  ['Validados', u.validated, 'hand'],
                  ['Com vídeo', u.withVideo, 'hand'],
                  ['Com avatar', u.withAvatar, 'neutral'],
                  ['Com fonte', u.withSource, 'neutral'],
                ] as const).map(([label, n, tone]) => (
                  <div key={label} className="unit-bar">
                    <dt>{label}</dt>
                    <dd>
                      <Meter value={n} max={u.signs} tone={tone} label={`${label}: ${n} de ${u.signs}`} />
                      <span className="unit-num">{fmtInt(n)}/{fmtInt(u.signs)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Sinais">
        <div className="filters" role="group" aria-label="Filtros dos sinais">
          <div className="segmented" role="radiogroup" aria-label="O que falta">
            {FILTERS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={filter === value}
                className={`segmented-item${filter === value ? ' is-on' : ''}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field-label">Unidade</span>
            <select value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Todas</option>
              {c.units.map((u) => <option key={u.id} value={u.id}>{u.id.toUpperCase()} {u.title}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Buscar</span>
            <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Glosa ou id" />
          </label>
        </div>
        <p className="count" role="status">
          {fmtInt(rows.length)} de {fmtInt(c.signs.length)} sinais{rows.length > shown ? `, mostrando ${fmtInt(shown)}` : ''}
        </p>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Sinal</th>
                <th scope="col">Unidade</th>
                <th scope="col">Situação</th>
                <th scope="col">Fonte</th>
                <th scope="col">O que falta</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((s) => (
                <tr key={s.id}>
                  <th scope="row">
                    <span className="gloss">{s.gloss}</span>
                    <span className="sub">{s.id}{s.recognition ? `, ${s.recognition === 'static' ? 'estático' : 'com movimento'}` : ''}</span>
                  </th>
                  <td>
                    {s.unitId ? `${s.unitId.toUpperCase()} ${unitTitle[s.unitId] ?? ''}` : '-'}
                    {s.lessonId && <span className="sub">{s.lessonId}</span>}
                  </td>
                  <td>
                    <span className="chips">
                      {s.validated ? <Chip tone="ok" icon="check">validado</Chip> : <Chip tone="warn" icon="info">{s.status ?? 'não validado'}</Chip>}
                      {s.hasVideo ? <Chip tone="ok" icon="videocam">vídeo</Chip> : <Chip tone="neutral" icon="videocam_off">sem vídeo</Chip>}
                      {s.hasAvatar ? <Chip tone="info" icon="sign_language">avatar</Chip> : <Chip tone="neutral" icon="close">sem avatar</Chip>}
                    </span>
                  </td>
                  <td>
                    {s.source
                      ? (s.source.url ? <a href={s.source.url} target="_blank" rel="noreferrer noopener">{s.source.name}</a> : s.source.name)
                      : <Chip tone="error" icon="warning">sem fonte</Chip>}
                  </td>
                  <td>{s.missing.length ? s.missing.map((m) => MISSING_LABELS[m] ?? m).join(', ') : <Chip tone="ok" icon="check">nada</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown && (
          <button type="button" className="btn btn--secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
            Mostrar mais {Math.min(PAGE_SIZE, rows.length - shown)}
          </button>
        )}
      </Card>
    </div>
  );
}
