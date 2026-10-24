import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

/** Número grande com rótulo (ativos hoje, gasto do mês). */
export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {hint && <span className="stat-hint">{hint}</span>}
    </div>
  );
}

export type ChipTone = 'ok' | 'warn' | 'error' | 'info' | 'neutral';

/** Selo de estado: fundo suave, ícone e texto (a cor nunca vem sozinha). */
export function Chip({ tone, icon, children }: { tone: ChipTone; icon?: string; children: ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      {icon && <Icon name={icon} size="1em" />}
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      {children && <div className="page-sub">{children}</div>}
    </header>
  );
}

export type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: T };

/** Carrega uma vez (e de novo com `reload`). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad({ state: 'loading' });
    fn()
      .then((data) => alive && setLoad({ state: 'ready', data }))
      .catch((err: Error) => alive && setLoad({ state: 'error', message: err.message || 'Erro ao carregar' }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return [load, reload];
}

/** Carregando e erro com o mesmo visual em todas as telas. */
export function Loaded<T>({ load, onRetry, children }: { load: Load<T>; onRetry: () => void; children: (data: T) => ReactNode }) {
  if (load.state === 'loading') {
    return (
      <p className="state" role="status">
        <span className="spinner" aria-hidden="true" /> Carregando...
      </p>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="state state--error" role="alert">
        <Chip tone="error" icon="warning">Erro</Chip>
        <span>{load.message}</span>
        <button type="button" className="btn btn--secondary" onClick={onRetry}>Tentar de novo</button>
      </div>
    );
  }
  return <>{children(load.data)}</>;
}
