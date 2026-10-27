import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { Chip } from '../components/ui';
import { AUTH_MESSAGES, AuthError, resetPasswordUrl, type AdminAuth, type Challenge, type SignInResult } from '../lib/auth';

/** Mínimo da política de senha do User Pool (infra/lib/librax-stack.ts, passwordPolicy). */
export const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Step = { kind: 'password' } | Challenge;

const messageOf = (err: unknown) => (err instanceof AuthError ? err.message : AUTH_MESSAGES.UNKNOWN);

/**
 * Entrar no painel: e-mail e senha, depois o código do aplicativo autenticador (quando a conta já tem)
 * ou a senha nova (conta criada com senha temporária). Sem cadastro: a conta é criada no app e
 * colocada no grupo admin (docs/painel-admin.md). "Esqueci a senha" abre a troca de senha do app.
 */
export function LoginScreen({ auth, onSignedIn, resetUrl = resetPasswordUrl() }: {
  auth: AdminAuth;
  onSignedIn: () => void;
  resetUrl?: string;
}) {
  const ids = useId();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  // Erro na senha: o foco vai para a mensagem (lida pelo leitor de tela). No código, fica no campo.
  useEffect(() => {
    if (!error) return;
    if (step.kind === 'totp') codeRef.current?.focus();
    else errorRef.current?.focus();
  }, [error, step.kind]);

  const emailOk = EMAIL_RE.test(email.trim());
  const formOk = emailOk && password.length > 0;
  const codeOk = /^\d{6}$/.test(code);
  const newPasswordOk = newPassword.length >= PASSWORD_MIN;

  function backToPassword(message: string | null = null) {
    setStep({ kind: 'password' });
    setPassword('');
    setCode('');
    setNewPassword('');
    setShowPassword(false);
    setError(message);
  }

  function follow(result: SignInResult) {
    if (result.kind === 'done') {
      onSignedIn();
      return;
    }
    setCode('');
    setNewPassword('');
    setShowPassword(false);
    setStep(result);
  }

  async function run(action: () => Promise<SignInResult>) {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      follow(await action());
    } catch (err) {
      // Desafio vencido ou já usado: volta para a senha
      if (err instanceof AuthError && err.code === 'SESSION_EXPIRED') backToPassword(err.message);
      else {
        if (step.kind === 'totp') setCode('');
        setError(messageOf(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(e: FormEvent) {
    e.preventDefault();
    if (!formOk) return;
    void run(() => auth.signIn(email.trim(), password));
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'totp') return;
    if (!codeOk) {
      setError(AUTH_MESSAGES.CODE_FORMAT);
      return;
    }
    void run(() => auth.confirmTotp(step, code));
  }

  function submitNewPassword(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'newPassword' || !newPasswordOk) return;
    void run(() => auth.completeNewPassword(step, newPassword));
  }

  const errorBox = error && (
    <p id={`${ids}-error`} ref={errorRef} tabIndex={-1} className="login-error" role="alert">
      <Icon name="warning" /> <span>{error}</span>
    </p>
  );
  const describedBy = (...extra: string[]) => [...extra, error ? `${ids}-error` : ''].filter(Boolean).join(' ') || undefined;
  const spinner = (text: string) => <><span className="spinner" aria-hidden="true" /> {text}</>;

  const passwordToggle = (
    <button
      type="button"
      className="login-toggle"
      onClick={() => setShowPassword((v) => !v)}
      aria-label={showPassword ? 'Esconder senha' : 'Mostrar senha'}
      aria-pressed={showPassword}
      disabled={busy}
    >
      <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
    </button>
  );

  if (step.kind === 'totp') {
    return (
      <>
        <Chip tone="info" icon="shield">Segundo fator</Chip>
        <h1 className="splash-title">Código do autenticador</h1>
        <p>Abra o aplicativo autenticador no celular e digite o código de 6 dígitos de <strong>Librax admin</strong>.</p>
        <form className="login-form" onSubmit={submitCode} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-code`}>Código de 6 dígitos</label>
            <input
              id={`${ids}-code`}
              ref={codeRef}
              className="login-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              enterKeyHint="done"
              autoFocus
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy()}
            />
          </div>
          {errorBox}
          <button type="submit" className="btn btn--primary login-submit" disabled={busy}>
            {busy ? spinner('Conferindo...') : <><Icon name="check" /> Confirmar</>}
          </button>
        </form>
        <p className="login-help">Perdeu o celular? Peça ao dono do projeto para desligar o autenticador da conta. No próximo acesso, o painel guia a configuração de novo.</p>
        <button type="button" className="btn btn--ghost" onClick={() => backToPassword()} disabled={busy}>
          <Icon name="arrow_back" /> Voltar
        </button>
      </>
    );
  }

  if (step.kind === 'newPassword') {
    return (
      <>
        <Chip tone="warn" icon="lock">Senha nova</Chip>
        <h1 className="splash-title">Crie uma senha nova</h1>
        <p>Esta conta entrou com uma senha temporária. Crie a sua para continuar.</p>
        <form className="login-form" onSubmit={submitNewPassword} noValidate>
          <div className="field">
            <label className="field-label" htmlFor={`${ids}-new`}>Senha nova</label>
            <div className="login-password">
              <input
                id={`${ids}-new`}
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                disabled={busy}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy(`${ids}-hint`)}
              />
              {passwordToggle}
            </div>
            <span id={`${ids}-hint`} className="login-hint">Pelo menos {PASSWORD_MIN} caracteres.</span>
          </div>
          {errorBox}
          <button type="submit" className="btn btn--primary login-submit" disabled={!newPasswordOk || busy}>
            {busy ? spinner('Salvando...') : <><Icon name="check" /> Salvar e entrar</>}
          </button>
        </form>
        <button type="button" className="btn btn--ghost" onClick={() => backToPassword()} disabled={busy}>
          <Icon name="arrow_back" /> Voltar
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="splash-title">Entrar no painel</h1>
      <p>Acesso só para contas de administração do Librax. Depois da senha, o painel pede o código do aplicativo autenticador.</p>
      <form className="login-form" onSubmit={submitPassword} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-email`}>E-mail</label>
          <input
            id={`${ids}-email`}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            disabled={busy}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy()}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${ids}-password`}>Senha</label>
          <div className="login-password">
            <input
              id={`${ids}-password`}
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy()}
            />
            {passwordToggle}
          </div>
          <a className="login-forgot" href={resetUrl} target="_blank" rel="noopener noreferrer" aria-label="Esqueci a senha (abre o app do Librax em outra aba)">
            Esqueci a senha
          </a>
        </div>
        {errorBox}
        <button type="submit" className="btn btn--primary login-submit" disabled={!formOk || busy}>
          {busy ? spinner('Entrando...') : <><Icon name="login" /> Entrar</>}
        </button>
      </form>
      <p className="login-help">A senha é a da conta no Librax. Para trocar, use "Esqueci a senha": a troca é feita no app, em outra aba, e depois é só voltar aqui.</p>
    </>
  );
}
