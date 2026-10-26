import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { BusyLabel } from '../components/BusyLabel';
import { LegalConsent } from '../components/LegalLinks';
import {
  authErrorCode, confirmEmailCode, confirmPasswordReset, getDisplayName, requestPasswordReset, signInWithEmail,
  googleEnabled, signInWithGoogle, signUpWithEmail,
} from '../lib/auth';
import { authAvailable, authErrorKey, refreshAccount, useAccount } from '../lib/account';
import { flushOutbox } from '../lib/sync';

export type AuthMode = 'login' | 'register';

interface Props {
  mode: AuthMode;
  /** Troca entre "Entrar" e "Criar conta" sem perder o que foi digitado no e-mail. */
  onSwitchMode: (mode: AuthMode) => void;
  /** Conta conectada (login, cadastro confirmado). */
  onDone: () => void;
  onBack: () => void;
}

/** Mínimo da política de senha do User Pool (infra/lib/librax-stack.ts, passwordPolicy). */
export const PASSWORD_MIN = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Busy = null | 'email' | 'google' | 'code' | 'resend';
type Step = 'form' | 'confirm' | 'forgot' | 'reset';

/**
 * LoginScreen e RegisterScreen (spec-02 12.3) em /entrar e /criar-conta. Google por redirect
 * (volta em /auth/callback); e-mail e senha com SRP. Apple fica de fora (desligada na infra).
 * Estados: edição (botão só habilita com campos válidos), enviando (spinner no botão e campos
 * travados) e erro (mensagem inline com os códigos de auth.ts). Cadastro novo pede o código
 * enviado por e-mail. "Esqueci a senha" (em Entrar) pede o e-mail, manda um código e troca a senha
 * com ele; a resposta é a mesma com ou sem conta (PreventUserExistenceErrors) e, trocada a senha,
 * entra com ela como o cadastro faz depois do código.
 */
export function AuthScreen({ mode, onSwitchMode, onDone, onBack }: Props) {
  const { t } = useT();
  const account = useAccount();
  const ids = useId();
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState(() => getDisplayName() ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const available = authAvailable();
  const google = googleEnabled();
  const isRegister = mode === 'register';
  const title = isRegister ? t('account.registerTitle') : t('account.loginTitle');

  // Trocar de Entrar para Criar conta (ou o contrário) volta ao formulário, sem erro antigo
  useEffect(() => {
    setStep('form');
    setError(null);
    setNotice(null);
  }, [mode]);

  useEffect(() => {
    if (error) errorRef.current?.focus({ preventScroll: false });
  }, [error]);

  const emailOk = EMAIL_RE.test(email.trim());
  const passwordOk = isRegister ? password.length >= PASSWORD_MIN : password.length > 0;
  const formOk = emailOk && passwordOk;
  const codeOk = /^\d{6}$/.test(code.trim());
  const resetOk = codeOk && password.length >= PASSWORD_MIN;

  function fail(err: unknown) {
    const c = authErrorCode(err);
    if (c === 'NOT_CONFIRMED') {
      setStep('confirm');
      setError(null);
    } else {
      setError(t(authErrorKey(c)));
    }
  }

  async function finish() {
    await refreshAccount();
    // Leva o progresso do convidado para a conta (POST /v1/guest/migrate) sem esperar
    void flushOutbox().catch(() => {});
    onDone();
  }

  async function signIn() {
    const r = await signInWithEmail(email.trim(), password);
    if (r.done) return finish();
    if (r.nextStep === 'CONFIRM_SIGN_UP') {
      setStep('confirm');
      return;
    }
    // Outros passos (troca de senha, MFA) ainda não têm tela
    setError(t('account.errors.unknown'));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!formOk || busy) return;
    setError(null);
    setNotice(null);
    setBusy('email');
    try {
      if (isRegister) {
        const r = await signUpWithEmail(email.trim(), password, name.trim() || undefined);
        if (r.needsConfirmation) setStep('confirm');
        else await signIn();
      } else {
        await signIn();
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm(e: FormEvent) {
    e.preventDefault();
    if (!codeOk || busy) return;
    setError(null);
    setBusy('code');
    try {
      await confirmEmailCode(email.trim(), code.trim());
      await signIn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  function openForgot() {
    setStep('forgot');
    setError(null);
    setNotice(null);
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    if (!emailOk || busy) return;
    setError(null);
    setBusy('email');
    try {
      await requestPasswordReset(email.trim());
      setCode('');
      setPassword('');
      setStep('reset');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleResend() {
    if (busy) return;
    setError(null);
    setNotice(null);
    setBusy('resend');
    try {
      await requestPasswordReset(email.trim());
      setNotice(t('account.reset.resent'));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    if (!resetOk || busy) return;
    setError(null);
    setNotice(null);
    setBusy('code');
    try {
      await confirmPasswordReset(email.trim(), code.trim(), password);
    } catch (err) {
      const c = authErrorCode(err);
      // Conta inexistente também volta como código errado: a mensagem não conta se ela existe
      setError(t(c === 'BAD_CODE' || c === 'INVALID_CREDENTIALS' ? 'account.reset.badCode' : authErrorKey(c)));
      setBusy(null);
      return;
    }
    // Senha trocada: entra com ela. Se o login falhar, fica em Entrar com o e-mail e a senha nova
    setStep('form');
    setCode('');
    setNotice(t('account.reset.done'));
    setBusy('email');
    try {
      await signIn();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(null);
    }
  }

  async function handleGoogle() {
    if (busy) return;
    setError(null);
    setBusy('google');
    try {
      // Sai da página: o Amplify guarda o PKCE e a volta acontece em /auth/callback
      await signInWithGoogle();
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  }

  const locked = busy !== null;

  let body;
  if (!available) {
    body = (
      <section className="auth-card" aria-labelledby={`${ids}-unavailable`}>
        <Icon name="cloud_off" size="48px" className="auth-card-icon" />
        <h2 id={`${ids}-unavailable`} className="auth-card-title">{t('account.unavailableTitle')}</h2>
        <p className="auth-card-text">{t('account.unavailableText')}</p>
        <button className="btn btn-primary" onClick={onBack}>
          {t('account.continueAsGuest')}
        </button>
      </section>
    );
  } else if (account.status === 'signedIn' && step === 'form' && !locked) {
    body = (
      <section className="auth-card" aria-labelledby={`${ids}-signed`}>
        <Icon name="cloud_done" size="48px" className="auth-card-icon" />
        <h2 id={`${ids}-signed`} className="auth-card-title">{t('account.alreadySignedIn')}</h2>
        {account.email && <p className="auth-card-text">{account.email}</p>}
        <button className="btn btn-primary" onClick={onDone}>
          {t('common.continue')} <Icon name="arrow_forward" />
        </button>
      </section>
    );
  } else if (step === 'confirm') {
    body = (
      <form className="auth-form" onSubmit={handleConfirm} noValidate>
        <h2 className="auth-card-title">{t('account.confirmTitle')}</h2>
        <p className="auth-lead">{t('account.confirmSub', { email: email.trim() })}</p>
        <div className="auth-field">
          <label className="auth-label" htmlFor={`${ids}-code`}>{t('account.codeLabel')}</label>
          <input
            id={`${ids}-code`}
            className="auth-input auth-input--code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={locked}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
            autoFocus
          />
        </div>
        {error && (
          <p id={`${ids}-error`} ref={errorRef} tabIndex={-1} className="auth-error" role="alert">
            <Icon name="warning" filled /> <span>{error}</span>
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!codeOk || locked} aria-busy={busy === 'code' || undefined}>
          {busy === 'code' ? <BusyLabel text={t('account.sending')} /> : t('account.confirm')}
        </button>
        <button type="button" className="btn-text" onClick={() => { setStep('form'); setError(null); }} disabled={locked}>
          {t('account.changeEmail')}
        </button>
      </form>
    );
  } else if (step === 'forgot') {
    body = (
      <>
        <form className="auth-form" onSubmit={handleForgot} noValidate>
          <h2 className="auth-card-title">{t('account.reset.title')}</h2>
          <p className="auth-lead">{t('account.reset.lead')}</p>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${ids}-email`}>{t('account.emailLabel')}</label>
            <input
              id={`${ids}-email`}
              className="auth-input"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={locked}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids}-error` : undefined}
              autoFocus
            />
          </div>
          {error && (
            <p id={`${ids}-error`} ref={errorRef} tabIndex={-1} className="auth-error" role="alert">
              <Icon name="warning" filled /> <span>{error}</span>
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={!emailOk || locked} aria-busy={busy === 'email' || undefined}>
            {busy === 'email' ? <BusyLabel text={t('account.sending')} /> : t('account.reset.sendCode')}
          </button>
          <button type="button" className="btn-text" onClick={() => { setStep('form'); setError(null); }} disabled={locked}>
            {t('account.reset.backToSignIn')}
          </button>
        </form>

        {google && (
          <>
            <p className="auth-notice" role="note">
              <Icon name="info" />
              <span>{t('account.reset.googleNote')}</span>
            </p>
            <button
              type="button"
              className="btn btn-ghost auth-google"
              onClick={handleGoogle}
              disabled={locked}
              aria-busy={busy === 'google' || undefined}
            >
              {busy === 'google' ? <BusyLabel text={t('account.openingGoogle')} /> : t('account.continueWithGoogle')}
            </button>
          </>
        )}
      </>
    );
  } else if (step === 'reset') {
    body = (
      <form className="auth-form" onSubmit={handleReset} noValidate>
        <h2 className="auth-card-title">{t('account.reset.codeTitle')}</h2>
        <p className="auth-lead">{t('account.reset.codeSub', { email: email.trim() })}</p>
        {notice && (
          <p className="auth-notice" role="status">
            <Icon name="mail" />
            <span>{notice}</span>
          </p>
        )}
        <div className="auth-field">
          <label className="auth-label" htmlFor={`${ids}-code`}>{t('account.codeLabel')}</label>
          <input
            id={`${ids}-code`}
            className="auth-input auth-input--code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
            disabled={locked}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-error` : undefined}
            autoFocus
          />
        </div>
        <div className="auth-field">
          <label className="auth-label" htmlFor={`${ids}-password`}>{t('account.reset.newPasswordLabel')}</label>
          <div className="auth-password">
            <input
              id={`${ids}-password`}
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              disabled={locked}
              aria-invalid={error ? true : undefined}
              aria-describedby={[`${ids}-hint`, error ? `${ids}-error` : ''].filter(Boolean).join(' ')}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? t('account.hidePassword') : t('account.showPassword')}
              aria-pressed={showPassword}
              disabled={locked}
            >
              <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
            </button>
          </div>
          <p id={`${ids}-hint`} className="auth-hint">{t('account.passwordHint', { n: PASSWORD_MIN })}</p>
        </div>
        {error && (
          <p id={`${ids}-error`} ref={errorRef} tabIndex={-1} className="auth-error" role="alert">
            <Icon name="warning" filled /> <span>{error}</span>
          </p>
        )}
        <button type="submit" className="btn btn-primary" disabled={!resetOk || locked} aria-busy={busy === 'code' || undefined}>
          {busy === 'code' ? <BusyLabel text={t('account.sending')} /> : t('account.reset.save')}
        </button>
        <p className="auth-hint">{t('account.reset.notReceived')}</p>
        <button type="button" className="btn-text" onClick={handleResend} disabled={locked} aria-busy={busy === 'resend' || undefined}>
          {busy === 'resend' ? <BusyLabel text={t('account.sending')} /> : t('account.reset.resend')}
        </button>
        <button type="button" className="btn-text" onClick={() => { setStep('forgot'); setError(null); setNotice(null); }} disabled={locked}>
          {t('account.changeEmail')}
        </button>
      </form>
    );
  } else {
    body = (
      <>
        <p className="auth-lead">{isRegister ? t('account.registerLead') : t('account.loginLead')}</p>
        {notice && (
          <p className="auth-notice" role="status">
            <Icon name="check_circle" />
            <span>{notice}</span>
          </p>
        )}

        {google && (
          <>
            <button
              type="button"
              className="btn btn-ghost auth-google"
              onClick={handleGoogle}
              disabled={locked}
              aria-busy={busy === 'google' || undefined}
            >
              {busy === 'google' ? <BusyLabel text={t('account.openingGoogle')} /> : t('account.continueWithGoogle')}
            </button>

            <p className="auth-divider" role="separator"><span>{t('account.or')}</span></p>
          </>
        )}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {isRegister && (
            <div className="auth-field">
              <label className="auth-label" htmlFor={`${ids}-name`}>{t('account.nameLabel')}</label>
              <input
                id={`${ids}-name`}
                className="auth-input"
                autoComplete="given-name"
                maxLength={30}
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={locked}
              />
            </div>
          )}
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${ids}-email`}>{t('account.emailLabel')}</label>
            <input
              id={`${ids}-email`}
              className="auth-input"
              type="email"
              inputMode="email"
              autoComplete={isRegister ? 'email' : 'username'}
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={e => setEmail(e.target.value)}
              disabled={locked}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${ids}-error` : undefined}
            />
          </div>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${ids}-password`}>{t('account.passwordLabel')}</label>
            <div className="auth-password">
              <input
                id={`${ids}-password`}
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={locked}
                aria-invalid={error ? true : undefined}
                aria-describedby={[isRegister ? `${ids}-hint` : '', error ? `${ids}-error` : ''].filter(Boolean).join(' ') || undefined}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? t('account.hidePassword') : t('account.showPassword')}
                aria-pressed={showPassword}
                disabled={locked}
              >
                <Icon name={showPassword ? 'visibility_off' : 'visibility'} />
              </button>
            </div>
            {isRegister && (
              <p id={`${ids}-hint`} className="auth-hint">{t('account.passwordHint', { n: PASSWORD_MIN })}</p>
            )}
            {!isRegister && (
              <button type="button" className="btn-text auth-forgot" onClick={openForgot} disabled={locked}>
                {t('account.reset.link')}
              </button>
            )}
          </div>

          {error && (
            <p id={`${ids}-error`} ref={errorRef} tabIndex={-1} className="auth-error" role="alert">
              <Icon name="warning" filled /> <span>{error}</span>
            </p>
          )}

          <button type="submit" className="btn btn-primary" disabled={!formOk || locked} aria-busy={busy === 'email' || undefined}>
            {busy === 'email'
              ? <BusyLabel text={t('account.sending')} />
              : isRegister ? t('account.createAccount') : t('account.signIn')}
          </button>
        </form>

        {/* Vale também para o Google, que cria a conta na primeira entrada */}
        <LegalConsent messageKey={isRegister ? 'legal.registerConsent' : 'legal.loginConsent'} />

        <p className="auth-switch">
          <span>{isRegister ? t('account.haveAccount') : t('account.noAccount')}</span>
          <button
            type="button"
            className="btn-text"
            onClick={() => onSwitchMode(isRegister ? 'login' : 'register')}
            disabled={locked}
          >
            {isRegister ? t('account.signIn') : t('account.createAccount')}
          </button>
        </p>
      </>
    );
  }

  return (
    <div className="sub-screen auth-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')} disabled={locked}>
          <Icon name="arrow_back" />
        </button>
        <h1>{title}</h1>
      </div>
      <div className="auth-body">{body}</div>
    </div>
  );
}
