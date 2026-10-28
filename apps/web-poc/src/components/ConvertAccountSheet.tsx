import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { BusyLabel } from './BusyLabel';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { authErrorCode, googleEnabled, signInWithGoogle } from '../lib/auth';
import { authAvailable, authErrorKey } from '../lib/account';
import { GoogleMark } from './GoogleMark';

interface Props {
  /** "Criar conta com e-mail": abre /criar-conta. */
  onCreateWithEmail: () => void;
  /** "Continuar sem conta": segue o fluxo normal. */
  onSkip: () => void;
  /** Voltar, Esc ou toque fora: só fecha, a pessoa continua na tela de conclusão. */
  onClose: () => void;
  /** Primeira lição concluída (o texto comemora a primeira). */
  firstLesson?: boolean;
}

/**
 * Convite para criar conta no fim da lição, como convidado (spec-02 12.2). O Google sai por
 * redirect na mesma aba; o progresso já está salvo no aparelho e é migrado na volta.
 * Sem Cognito neste ambiente, avisa que o login está indisponível e só deixa continuar.
 */
export function ConvertAccountSheet({ onCreateWithEmail, onSkip, onClose, firstLesson = false }: Props) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const available = authAvailable();
  const google = googleEnabled();
  // Voltar fecha o sheet (design-system 11.13)
  useCloseOnBack(true, onClose);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    titleRef.current?.focus({ preventScroll: true });
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  async function handleGoogle() {
    setError(null);
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(t(authErrorKey(authErrorCode(err))));
      setBusy(false);
    }
  }

  return (
    <div
      className={`streak-sheet-backdrop${visible ? ' streak-sheet-backdrop--visible' : ''}`}
      onClick={busy ? undefined : onClose}
    >
      <div
        className={`streak-sheet${visible ? ' streak-sheet--open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-sheet-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="streak-sheet-handle" aria-hidden="true" />

        <div className="streak-sheet-icon streak-sheet-icon--install">
          <Icon name="cloud_done" />
        </div>

        <h2 id="account-sheet-title" ref={titleRef} tabIndex={-1} className="streak-sheet-title">
          {t('account.offerTitle')}
        </h2>
        <p className="streak-sheet-sub">{firstLesson ? t('account.offerSub') : t('account.offerSubLater')}</p>

        {available ? (
          <div className="streak-sheet-actions">
            <button className="btn btn-primary" onClick={onCreateWithEmail} disabled={busy}>
              <Icon name="mail" /> {t('account.createWithEmail')}
            </button>
            {google && (
              <button className="btn btn-ghost" onClick={handleGoogle} disabled={busy} aria-busy={busy || undefined}>
                {busy ? <BusyLabel text={t('account.openingGoogle')} /> : <><GoogleMark /> {t('account.continueWithGoogle')}</>}
              </button>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="btn-text-muted" onClick={onSkip} disabled={busy}>
              {t('account.continueWithoutAccount')}
            </button>
          </div>
        ) : (
          <>
            <p className="auth-notice" role="note">
              <Icon name="cloud_off" />
              <span>{t('account.unavailableShort')}</span>
            </p>
            <div className="streak-sheet-actions">
              <button className="btn btn-primary" onClick={onSkip}>
                {t('common.continue')} <Icon name="arrow_forward" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
