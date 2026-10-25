import { useMemo, useState } from 'react';
import { RankList } from '../components/Chart';
import { Card, Chip, Loaded, PageHeader, StatTile, useLoad, type ChipTone } from '../components/ui';
import { useApi } from '../lib/context';
import { fmtDay, fmtDec, fmtInt, fmtPct } from '../lib/format';
import type { CameraLevel, CameraSignRow, CameraView as Camera } from '../lib/types';

/** Abaixo disso a taxa é ruído: fica fora da lista, a não ser que se peça para ver. */
export const MIN_RUNS = 5;

const LEVEL: Record<CameraLevel, [ChipTone, string, string]> = {
  hard: ['error', 'warning', 'Difícil'],
  attention: ['warn', 'info', 'Atenção'],
  ok: ['ok', 'check', 'Vai bem'],
};

type Kind = 'all' | 'letter' | 'sign';
const KINDS: Array<[Kind, string]> = [['all', 'Todos'], ['letter', 'Letras'], ['sign', 'Sinais']];

/**
 * Desempenho da câmera de todas as pessoas com conta (o app manda o de cada lição com a conclusão).
 * Vem da mesma rota da Operação (GET /v1/admin/overview), na mesma janela de 30 dias.
 */
export function CameraScreen() {
  const api = useApi();
  const [load, reload] = useLoad(() => api.overview());
  return (
    <>
      <PageHeader title="Câmera">
        Últimos 30 dias, somando todas as pessoas com conta: onde o reconhecimento ou a descrição do sinal falham.
      </PageHeader>
      <Loaded load={load} onRetry={reload}>
        {(o) => <CameraView camera={o.camera} range={o.range} />}
      </Loaded>
    </>
  );
}

const label = (r: { gloss: string | null; signId: string }) => r.gloss ?? r.signId;

export function CameraView({ camera, range }: { camera: Camera; range: { from: string; to: string } }) {
  const [kind, setKind] = useState<Kind>('all');
  const [showFew, setShowFew] = useState(false);
  const { totals } = camera;
  const period = `${fmtDay(range.from)} a ${fmtDay(range.to)}`;

  const ofKind = useMemo(() => camera.signs.filter((s) => kind === 'all' || s.kind === kind), [camera.signs, kind]);
  const rows = showFew ? ofKind : ofKind.filter((s) => s.runs >= MIN_RUNS);
  const hidden = ofKind.length - rows.length;

  if (totals.runs === 0) {
    return (
      <Card>
        <p className="empty">Ainda sem números da câmera no período ({period}). Eles chegam com as lições concluídas por quem tem conta.</p>
      </Card>
    );
  }

  return (
    <div className="stack">
      <div className="stats">
        <StatTile label="Letras e sinais" value={fmtInt(totals.signs)} hint={period} />
        <StatTile label="Vezes na câmera" value={fmtInt(totals.runs)} hint={`${fmtInt(totals.successes)} acertos`} />
        <StatTile label="Taxa de pulo" value={fmtPct(totals.skips / totals.runs)} hint={`${fmtInt(totals.skips)} pulos`} />
        <StatTile label="Leituras trocadas" value={fmtInt(totals.wrongReadings)} hint="a câmera leu outro sinal" />
      </div>

      <Card title="Do mais difícil para o mais fácil">
        <div className="filters" role="group" aria-label="Filtros da câmera">
          <div className="segmented" role="radiogroup" aria-label="Letras ou sinais">
            {KINDS.map(([value, text]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                className={`segmented-item${kind === value ? ' is-on' : ''}`}
                onClick={() => setKind(value)}
              >
                {text}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={showFew} onChange={(e) => setShowFew(e.target.checked)} />
            Mostrar os com menos de {MIN_RUNS} vezes
          </label>
        </div>
        <p className="count" role="status">
          {fmtInt(rows.length)} de {fmtInt(ofKind.length)}
          {hidden > 0 ? `, ${fmtInt(hidden)} com menos de ${MIN_RUNS} vezes fora da lista` : ''}
        </p>
        {rows.length === 0 ? (
          <p className="empty">Nenhuma letra ou sinal com {MIN_RUNS} vezes ou mais no período.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Letra ou sinal</th>
                  <th scope="col">Nível</th>
                  <th scope="col" className="num">Vezes</th>
                  <th scope="col" className="num">Pulos</th>
                  <th scope="col" className="num">Tentativas até acertar</th>
                  <th scope="col">A câmera leu no lugar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => <CameraRow key={s.signId} s={s} />)}
              </tbody>
            </table>
          </div>
        )}
        <p className="note">
          Uma vez: do momento em que a câmera abre até acertar ou pular. Tentativa: cada leitura diferente da câmera até
          acertar. Difícil: metade ou mais de pulos, ou 3 tentativas ou mais em média; atenção a partir de 20% de pulos ou 2
          tentativas (a mesma regra da tela do app).
        </p>
      </Card>

      <Card title="Leituras trocadas mais comuns">
        <RankList
          rows={camera.confusions.map((c) => ({
            key: `${c.signId}:${c.label}`,
            label: `${label(c)} lido como ${c.label}`,
            detail: c.signId,
            value: c.count,
          }))}
          tone="error"
          label="Leituras trocadas mais comuns"
          empty="Nenhuma leitura trocada no período."
        />
        <p className="note">Só letras e sinais do curso: o servidor descarta qualquer outro rótulo.</p>
      </Card>
    </div>
  );
}

function CameraRow({ s }: { s: CameraSignRow }) {
  const [tone, icon, text] = LEVEL[s.level];
  return (
    <tr>
      <th scope="row">
        <span className="gloss">{label(s)}</span>
        <span className="sub">{s.signId}{s.kind ? `, ${s.kind === 'letter' ? 'letra' : 'sinal'}` : ''}</span>
      </th>
      <td><Chip tone={tone} icon={icon}>{text}</Chip></td>
      <td className="num">{fmtInt(s.runs)}</td>
      <td className="num">{fmtInt(s.skips)} ({fmtPct(s.skipRate)})</td>
      <td className="num">{s.avgAttempts == null ? 'sem acerto' : `${fmtDec(s.avgAttempts)} em média`}</td>
      <td>{s.topWrong.length ? s.topWrong.map((w) => `${w.label} (${fmtInt(w.count)})`).join(', ') : '-'}</td>
    </tr>
  );
}
