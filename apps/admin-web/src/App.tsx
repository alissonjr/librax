import { useEffect, useState } from 'react';
import { NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { Icon } from './components/Icon';
import { Chip } from './components/ui';
import { ApiError, type AdminApi } from './lib/api';
import type { AdminAuth } from './lib/auth';
import { ApiContext } from './lib/context';
import { cognitoMfaSetup, type MfaSetupApi } from './lib/mfa';
import { applyTheme, loadTheme, nextTheme, THEME_LABEL, type ThemeChoice } from './lib/theme';
import type { Me } from './lib/types';
import { OperacaoScreen } from './screens/OperacaoScreen';
import { ConteudoScreen } from './screens/ConteudoScreen';
import { ContasScreen } from './screens/ContasScreen';
import { SquadsScreen } from './screens/SquadsScreen';
import { CustoScreen } from './screens/CustoScreen';
import { UsoScreen } from './screens/UsoScreen';
import { CameraScreen } from './screens/CameraScreen';
import { MfaSetupScreen } from './screens/MfaSetupScreen';
import { LoginScreen } from './screens/LoginScreen';

/**
 * As squads ainda não abriram no app: a aba fica fora da barra até lá (a tela continua em /squads).
 * Quando abrirem, é só trocar para true.
 */
export const SQUADS_OPEN = false;

/** Barra lateral em dois grupos: o que se acompanha (números) e o que se gerencia. */
const NAV: Array<{ title: string; items: Array<[string, string, string]> }> = [
  {
    title: 'Acompanhar',
    items: [
      ['/', 'Operação', 'trending_up'],
      ['/uso', 'Uso', 'query_stats'],
      ['/camera', 'Câmera', 'videocam'],
      ['/custo', 'Custo', 'payments'],
    ],
  },
  {
    title: 'Gerenciar',
    items: [
      ['/contas', 'Contas', 'person'],
      ['/conteudo', 'Conteúdo', 'sign_language'],
      ...(SQUADS_OPEN ? [['/squads', 'Squads', 'group'] as [string, string, string]] : []),
    ],
  },
];

export function AdminApp({ api, session, mfa }: { api: AdminApi; session: AdminAuth; mfa?: MfaSetupApi }) {
  const [mfaSetup] = useState<MfaSetupApi>(() => mfa ?? cognitoMfaSetup());
  return (
    <ApiContext.Provider value={api}>
      <Routes>
        <Route path="*" element={<Gate api={api} session={session} mfa={mfaSetup} />}>
          <Route index element={<OperacaoScreen />} />
          <Route path="camera" element={<CameraScreen />} />
          <Route path="conteudo" element={<ConteudoScreen />} />
          <Route path="contas" element={<ContasScreen />} />
          <Route path="squads" element={<SquadsScreen />} />
          <Route path="custo" element={<CustoScreen />} />
          <Route path="uso" element={<UsoScreen />} />
          <Route path="*" element={<OperacaoScreen />} />
        </Route>
      </Routes>
    </ApiContext.Provider>
  );
}

type GateState =
  | { kind: 'login' }
  | { kind: 'checking' }
  | { kind: 'denied' }
  | { kind: 'mfa' }
  | { kind: 'federated' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; me: Me };

/**
 * Só abre o painel depois que a API confirma o grupo admin e o aplicativo autenticador da conta
 * (GET /v1/admin/me). Sem o autenticador, guia a configuração no primeiro acesso.
 */
function Gate({ api, session, mfa }: { api: AdminApi; session: AdminAuth; mfa: MfaSetupApi }) {
  const [state, setState] = useState<GateState>(() => (session.hasSession() ? { kind: 'checking' } : { kind: 'login' }));
  const [attempt, setAttempt] = useState(0);
  const recheck = () => setAttempt((n) => n + 1);
  // Sair: apaga do navegador na hora, revoga no Cognito em segundo plano e volta para a tela de entrar
  const logout = () => {
    void session.signOut();
    setState({ kind: 'login' });
  };

  useEffect(() => {
    if (!session.hasSession()) {
      setState({ kind: 'login' });
      return;
    }
    let alive = true;
    setState({ kind: 'checking' });
    api.me()
      .then((me) => alive && setState({ kind: 'ok', me }))
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof ApiError && err.code === 'ADMIN_MFA_REQUIRED') setState({ kind: 'mfa' });
        else if (err instanceof ApiError && err.code === 'ADMIN_MFA_FEDERATED') setState({ kind: 'federated' });
        else if (err instanceof ApiError && err.status === 403) setState({ kind: 'denied' });
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
        <LoginScreen auth={session} onSignedIn={recheck} />
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
        <button type="button" className="btn btn--secondary" onClick={logout}>
          <Icon name="logout" /> Sair
        </button>
      </Splash>
    );
  }
  if (state.kind === 'mfa') {
    return (
      <Splash>
        <MfaSetupScreen setup={mfa} onDone={recheck} onLogout={logout} />
      </Splash>
    );
  }
  if (state.kind === 'federated') {
    return (
      <Splash>
        <Chip tone="error" icon="lock">Sem acesso</Chip>
        <h1 className="splash-title">Entre com e-mail e senha</h1>
        <p>O painel exige o aplicativo autenticador, que só existe nas contas de e-mail e senha do Librax. Contas do Google não servem aqui. Crie uma conta de e-mail e senha só para o painel e peça ao dono do projeto para colocá-la no grupo admin.</p>
        <button type="button" className="btn btn--secondary" onClick={logout}>
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
        <button type="button" className="btn btn--primary" onClick={recheck}>Tentar de novo</button>
      </Splash>
    );
  }
  return <Shell me={state.me} onLogout={logout} />;
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

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [theme, setTheme] = useState<ThemeChoice>(loadTheme);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <div className="shell">
      <aside className="side">
        <Brand />
        <nav className="nav" aria-label="Seções do painel">
          {NAV.map((group) => (
            <div key={group.title} className="nav-group" role="group" aria-labelledby={`nav-${group.title}`}>
              <span className="nav-title" id={`nav-${group.title}`}>{group.title}</span>
              {group.items.map(([to, label, icon]) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' is-on' : ''}`}>
                  {({ isActive }) => (
                    <>
                      {/* No celular, como no app: ícone preenchido sobre a pílula na aba aberta */}
                      <span className="nav-ico"><Icon name={icon} filled={isActive} /></span> <span className="nav-label">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <Chip tone="info" icon="shield">admin com autenticador</Chip>
          <span className="who" title={me.email ?? me.userId}>{me.email ?? me.userId}</span>
          <div className="side-actions">
            <button type="button" className="btn btn--ghost" onClick={() => setTheme(nextTheme(theme))} aria-label={`${THEME_LABEL[theme]}. Trocar tema`}>
              <Icon name="contrast" /> <span>{THEME_LABEL[theme]}</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={onLogout}>
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
