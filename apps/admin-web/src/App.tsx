import { useEffect, useState } from 'react';
import { NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './components/Icon';
import { Chip } from './components/ui';
import { ApiError, type AdminApi } from './lib/api';
import { ApiContext } from './lib/context';
import { applyTheme, loadTheme, nextTheme, THEME_LABEL, type ThemeChoice } from './lib/theme';
import type { Me } from './lib/types';
import { OperacaoScreen } from './screens/OperacaoScreen';
import { ConteudoScreen } from './screens/ConteudoScreen';
import { ContasScreen } from './screens/ContasScreen';
import { SquadsScreen } from './screens/SquadsScreen';
import { CustoScreen } from './screens/CustoScreen';
import { CameraScreen } from './screens/CameraScreen';

/** Sessão do painel (lib/auth.ts em produção; um falso nos testes e no modo de exemplo). */
export interface Session {
  hasToken(): boolean;
  login(): void | Promise<void>;
  logout(): void;
  completeLogin(search: string): Promise<void>;
  clear(): void;
}

const NAV: Array<[string, string, string]> = [
  ['/', 'Operação', 'trending_up'],
  ['/camera', 'Câmera', 'videocam'],
  ['/conteudo', 'Conteúdo', 'sign_language'],
  ['/contas', 'Contas', 'person'],
  ['/squads', 'Squads', 'group'],
  ['/custo', 'Custo', 'cloud_done'],
];

export function AdminApp({ api, session }: { api: AdminApi; session: Session }) {
  return (
    <ApiContext.Provider value={api}>
      <Routes>
        <Route path="/auth/callback" element={<Callback session={session} />} />
        <Route path="*" element={<Gate api={api} session={session} />}>
          <Route index element={<OperacaoScreen />} />
          <Route path="camera" element={<CameraScreen />} />
          <Route path="conteudo" element={<ConteudoScreen />} />
          <Route path="contas" element={<ContasScreen />} />
          <Route path="squads" element={<SquadsScreen />} />
          <Route path="custo" element={<CustoScreen />} />
          <Route path="*" element={<OperacaoScreen />} />
        </Route>
      </Routes>
    </ApiContext.Provider>
  );
}

function Callback({ session }: { session: Session }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    session.completeLogin(location.search)
      .then(() => navigate('/', { replace: true }))
      .catch((err: Error) => setError(err.message));
    // a volta do login roda uma vez
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Splash>
      {error ? (
        <>
          <Chip tone="error" icon="warning">Erro no login</Chip>
          <p>{error}</p>
          <button type="button" className="btn btn--primary" onClick={() => void session.login()}>Entrar de novo</button>
        </>
      ) : (
        <p role="status"><span className="spinner" aria-hidden="true" /> Entrando...</p>
      )}
    </Splash>
  );
}

type GateState = { kind: 'login' } | { kind: 'checking' } | { kind: 'denied' } | { kind: 'error'; message: string } | { kind: 'ok'; me: Me };

/** Só abre o painel depois que a API confirma o grupo admin (GET /v1/admin/me). */
function Gate({ api, session }: { api: AdminApi; session: Session }) {
  const [state, setState] = useState<GateState>(() => (session.hasToken() ? { kind: 'checking' } : { kind: 'login' }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!session.hasToken()) {
      setState({ kind: 'login' });
      return;
    }
    let alive = true;
    setState({ kind: 'checking' });
    api.me()
      .then((me) => alive && setState({ kind: 'ok', me }))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.status === 403) setState({ kind: 'denied' });
        else if (err instanceof ApiError && err.status === 401) {
          session.clear();
          setState({ kind: 'login' });
        } else setState({ kind: 'error', message: (err as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [api, session, attempt]);

  if (state.kind === 'login') {
    return (
      <Splash>
        <h1 className="splash-title">Painel de administração</h1>
        <p>Acesso só para contas no grupo admin. Use a mesma conta do Librax.</p>
        <button type="button" className="btn btn--primary" onClick={() => void session.login()}>
          <Icon name="login" /> Entrar
        </button>
      </Splash>
    );
  }
  if (state.kind === 'checking') {
    return <Splash><p role="status"><span className="spinner" aria-hidden="true" /> Conferindo o acesso...</p></Splash>;
  }
  if (state.kind === 'denied') {
    return (
      <Splash>
        <Chip tone="error" icon="lock">Sem acesso</Chip>
        <h1 className="splash-title">Esta conta não é de administração</h1>
        <p>O painel só abre para contas no grupo admin do Cognito. Peça acesso ao dono do projeto e entre de novo.</p>
        <button type="button" className="btn btn--secondary" onClick={() => session.logout()}>
          <Icon name="logout" /> Sair
        </button>
      </Splash>
    );
  }
  if (state.kind === 'error') {
    return (
      <Splash>
        <Chip tone="error" icon="warning">Erro</Chip>
        <p>{state.message}</p>
        <button type="button" className="btn btn--primary" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</button>
      </Splash>
    );
  }
  return <Shell me={state.me} session={session} />;
}

function Brand() {
  return (
    <span className="brand">
      <img src="/favicon.svg" alt="" width={28} height={28} />
      <span className="brand-name">librax</span>
      <span className="brand-tag">admin</span>
    </span>
  );
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <main className="splash">
      <Brand />
      <div className="splash-body">{children}</div>
    </main>
  );
}

function Shell({ me, session }: { me: Me; session: Session }) {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <div className="shell">
      <aside className="side">
        <Brand />
        <nav className="nav" aria-label="Seções do painel">
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' is-on' : ''}`}>
              <Icon name={icon} /> <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <Chip tone="info" icon="visibility">só leitura</Chip>
          <span className="who" title={me.email ?? me.userId}>{me.email ?? me.userId}</span>
          <div className="side-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setTheme(nextTheme(theme))} aria-label={`${THEME_LABEL[theme]}. Trocar tema`}>
              <Icon name="contrast" /> <span>{THEME_LABEL[theme]}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => session.logout()}>
              <Icon name="logout" /> <span>Sair</span>
            </button>
          </div>
        </div>
      </aside>
      <main className="main" id="conteudo">
        <Outlet />
      </main>
    </div>
  );
}
