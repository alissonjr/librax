import { useEffect, useState } from 'react';
import { Meter } from '../components/Chart';
import { Card, Chip, PageHeader } from '../components/ui';
import { useApi } from '../lib/context';
import { fmtDate, fmtInt } from '../lib/format';
import type { SquadRow } from '../lib/types';

const TYPE: Record<string, [string, 'info' | 'neutral' | 'ok']> = {
  public: ['pública', 'info'],
  private: ['privada', 'neutral'],
  org: ['organização', 'ok'],
};

export function SquadsScreen() {
  const api = useApi();
  const [squads, setSquads] = useState<SquadRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'idle' | 'error'>('loading');
  const [error, setError] = useState('');

  async function load(from: string | null) {
    setState('loading');
    try {
      const page = await api.squads(from);
      setSquads((prev) => (from ? [...prev, ...page.squads] : page.squads));
      setCursor(page.cursor);
      setState('idle');
    } catch (err) {
      setError((err as Error).message);
      setState('error');
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader title="Squads">Da mais nova para a mais velha. Moderação fica para a segunda etapa.</PageHeader>
      <Card>
        {squads.length === 0 && state === 'idle' && <p className="empty">Nenhuma squad criada ainda.</p>}
        {squads.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Tamanho</th>
                  <th scope="col" className="num">XP na semana</th>
                  <th scope="col">Criada em</th>
                </tr>
              </thead>
              <tbody>
                {squads.map((s) => {
                  const [label, tone] = TYPE[s.type ?? ''] ?? [s.type ?? '-', 'neutral'];
                  return (
                    <tr key={s.squadId}>
                      <th scope="row">{s.name ?? s.squadId}<span className="sub">{s.squadId}</span></th>
                      <td><Chip tone={tone}>{label}</Chip></td>
                      <td>
                        <span className="size">
                          <Meter value={s.memberCount} max={s.maxMembers ?? s.memberCount} tone="hand" label={`${s.memberCount} de ${s.maxMembers ?? '?'} membros`} />
                          <span className="unit-num">{fmtInt(s.memberCount)}/{fmtInt(s.maxMembers)}</span>
                        </span>
                      </td>
                      <td className="num">{fmtInt(s.xpWeekly)}</td>
                      <td>{fmtDate(s.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {state === 'loading' && <p className="state" role="status"><span className="spinner" aria-hidden="true" /> Carregando...</p>}
        {state === 'error' && (
          <div className="state state--error" role="alert">
            <Chip tone="error" icon="warning">Erro</Chip> {error}
            <button type="button" className="btn btn--secondary" onClick={() => void load(cursor)}>Tentar de novo</button>
          </div>
        )}
        {state === 'idle' && cursor && (
          <button type="button" className="btn btn--secondary" onClick={() => void load(cursor)}>Carregar mais</button>
        )}
        <p className="count" role="status">{fmtInt(squads.length)} squads{cursor ? ' (há mais)' : ''}</p>
      </Card>
    </>
  );
}
