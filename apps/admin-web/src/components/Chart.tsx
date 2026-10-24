import { useId, useState, type CSSProperties } from 'react';
import { fmtInt } from '../lib/format';

/*
 * Gráficos simples em HTML e CSS, com as cores dos tokens do Traço (funcionam nos dois temas).
 * Uma série por gráfico, um eixo só. A cor diz o assunto e é sempre a mesma:
 *   hand    petróleo  pessoas (ativas, contas)
 *   trace   tangerina lições
 *   error   framboesa erros (com o número escrito ao lado: nunca só a cor)
 *   neutral grafite   dinheiro e o resto
 * Cada gráfico tem a tabela com os mesmos números logo abaixo ("Ver tabela").
 */

export type Tone = 'hand' | 'trace' | 'error' | 'neutral';

export interface BarDatum {
  /** Rótulo curto do eixo (ex.: "23 out"). */
  label: string;
  /** null = sem dado (desenhado vazado, diferente de zero). */
  value: number | null;
}

/** Topo "redondo" do eixo: 1, 2 ou 5 vezes uma potência de 10. */
export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

interface BarChartProps {
  title: string;
  data: BarDatum[];
  tone: Tone;
  format?: (n: number) => string;
  /** Nome da medida na tabela (ex.: "Pessoas ativas"). */
  measure: string;
  /** Altura da área do gráfico em px. */
  height?: number;
}

export function BarChart({ title, data, tone, format = fmtInt, measure, height = 160 }: BarChartProps) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const values = data.map((d) => d.value ?? 0);
  const top = niceMax(Math.max(0, ...values));
  const total = values.reduce((a, b) => a + b, 0);
  const missing = data.filter((d) => d.value == null).length;
  const summary = `${title}: ${data.length} barras, de ${data[0]?.label ?? ''} a ${data.at(-1)?.label ?? ''}, maior valor ${format(Math.max(0, ...values))}`;
  // rótulos do eixo x: primeiro, meio e último
  const ticks = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  const shown = active == null ? null : data[active];

  return (
    <figure className={`chart chart--${tone}`} aria-labelledby={`${id}-t`}>
      <figcaption className="chart-head">
        <span id={`${id}-t`} className="chart-title">{title}</span>
        <span className="chart-readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{shown.value == null ? 'sem dado' : format(shown.value)}</strong> {shown.label}
            </>
          ) : (
            <>
              total <strong>{format(total)}</strong>
            </>
          )}
        </span>
      </figcaption>
      <div className="chart-plot" role="img" aria-label={summary} style={{ '--h': `${height}px` } as CSSProperties}>
        <div className="chart-axis" aria-hidden="true">
          <span>{format(top)}</span>
          <span>{format(top / 2)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars" onMouseLeave={() => setActive(null)}>
          {data.map((d, i) => (
            <button
              type="button"
              key={`${d.label}-${i}`}
              className={`chart-bar${d.value == null ? ' chart-bar--empty' : ''}${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${d.label}: ${d.value == null ? 'sem dado' : format(d.value)}`}
              tabIndex={0}
            >
              <span
                className="chart-bar-fill"
                style={{ height: d.value == null ? '100%' : `${Math.max((d.value / top) * 100, d.value > 0 ? 2 : 0)}%` }}
              />
            </button>
          ))}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {data.map((d, i) => (
          <span key={`${d.label}-${i}`}>{ticks.has(i) ? d.label : ''}</span>
        ))}
      </div>
      {missing > 0 && (
        <p className="chart-note">
          <span className="chart-swatch chart-swatch--empty" aria-hidden="true" /> barra vazada: ainda sem dado
        </p>
      )}
      <details className="chart-table">
        <summary>Ver tabela</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Período</th>
              <th scope="col" className="num">{measure}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-${i}`}>
                <td>{d.label}</td>
                <td className="num">{d.value == null ? 'sem dado' : format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Barra de proporção (ex.: sinais validados de uma unidade). */
export function Meter({ value, max, tone, label }: { value: number; max: number; tone: Tone; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className={`meter meter--${tone}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span className="meter-fill" style={{ width: `${pct}%` }} />
    </span>
  );
}

export interface RankRow {
  key: string;
  label: string;
  detail?: string;
  value: number;
  /** Texto do valor (ex.: "40%"); padrão: o número. */
  display?: string;
}

/** Ranking em barras horizontais: rótulo, barra proporcional ao maior e o número escrito. */
export function RankList({ rows, tone, empty, label }: { rows: RankRow[]; tone: Tone; empty: string; label: string }) {
  if (rows.length === 0) return <p className="empty">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ol className="rank" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="rank-row">
          <span className="rank-label">
            {r.label}
            {r.detail && <span className="rank-detail">{r.detail}</span>}
          </span>
          <Meter value={r.value} max={max} tone={tone} label={`${r.label}: ${r.display ?? fmtInt(r.value)}`} />
          <span className="rank-value">{r.display ?? fmtInt(r.value)}</span>
        </li>
      ))}
    </ol>
  );
}
