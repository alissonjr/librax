import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { SocialAccountInvite } from '../components/SocialAccountInvite';
import { useAccount } from '../lib/account';
import {
  clearPendingInvite, createPrivateLeague, fetchMyPrivateLeagues, joinPrivateLeague, normalizeInviteCode,
  INVITE_CODE_LENGTH, PRIVATE_NAME_MAX, PRIVATE_NAME_MIN, type PrivateLeague,
} from '../lib/social';
import '../styles/league.css';

interface Props {
  mode: 'create' | 'join';
  /** Código do link de convite: já vem preenchido e a entrada começa sozinha. */
  initialCode?: string;
  onBack: () => void;
  onDone: (league: PrivateLeague) => void;
  onAccount: (mode: 'register' | 'login') => void;
}

/** Mensagem de cada erro do servidor (handlers/squads.js), no idioma do app. */
const ERROR_KEYS: Record<string, string> = {
  SQUADS_LIMIT_REACHED: 'privateLeague.errLimit',
  INVALID_NAME: 'privateLeague.errName',
  SQUAD_NOT_FOUND: 'privateLeague.errCode',
  SQUAD_FULL: 'privateLeague.errFull',
  ALREADY_MEMBER: 'privateLeague.errAlready',
  OFFLINE: 'social.offlineTitle',
};

/** Criar uma liga privada (só o nome) ou entrar numa com o código de 6 letras. */
export function PrivateLeagueFormScreen({ mode, initialCode = '', onBack, onDone, onAccount }: Props) {
  const { t } = useT();
  const account = useAccount();
  const [value, setValue] = useState(mode === 'join' ? normalizeInviteCode(initialCode) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoJoined = useRef(false);

  const valid = mode === 'create'
    ? value.trim().length >= PRIVATE_NAME_MIN && value.trim().length <= PRIVATE_NAME_MAX
    : value.length === INVITE_CODE_LENGTH;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = mode === 'create' ? await createPrivateLeague(value) : await joinPrivateLeague(value);
    setBusy(false);
    if (res.ok) {
      if (mode === 'join') clearPendingInvite();
      onDone(res.data);
      return;
    }
    if (mode === 'join' && res.code === 'ALREADY_MEMBER') {
      clearPendingInvite();
      // Já está nela (convite aberto de novo): abre a liga em vez do erro
      const mine = await fetchMyPrivateLeagues();
      const found = mine.kind === 'ok' ? mine.data.find(l => l.inviteCode === normalizeInviteCode(value)) : undefined;
      if (found) {
        onDone(found);
        return;
      }
    }
    setError(t(ERROR_KEYS[res.code] ?? 'privateLeague.actionFailed'));
  };

  // Link de convite: entra sozinho assim que a conta estiver pronta
  useEffect(() => {
    if (mode !== 'join' || autoJoined.current || account.status !== 'signedIn') return;
    if (normalizeInviteCode(initialCode).length !== INVITE_CODE_LENGTH) return;
    autoJoined.current = true;
    void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, account.status, initialCode]);

  const title = mode === 'create' ? t('privateLeague.createTitle') : t('privateLeague.joinTitle');

  return (
    <div className="sub-screen league-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{title}</h1>
      </div>

      <div className="league-body">
        {account.status === 'checking' && <p className="text-muted league-loading">{t('common.loading')}</p>}
        {(account.status === 'guest' || account.status === 'unavailable') && (
          <SocialAccountInvite
            text={t('privateLeague.guestText')}
            onCreateAccount={() => onAccount('register')}
            onLogin={() => onAccount('login')}
          />
        )}

        {account.status === 'signedIn' && (
          <form className="private-form" onSubmit={submit} noValidate>
            <p className="social-lead">{mode === 'create' ? t('privateLeague.createLead') : t('privateLeague.joinLead')}</p>
            <label className="private-form-label" htmlFor="private-form-input">
              {mode === 'create' ? t('privateLeague.nameLabel') : t('privateLeague.codeInputLabel')}
            </label>
            <input
              id="private-form-input"
              className={`auth-input${mode === 'join' ? ' auth-input--code' : ''}`}
              value={value}
              onChange={e => setValue(mode === 'join' ? normalizeInviteCode(e.target.value) : e.target.value)}
              maxLength={mode === 'create' ? PRIVATE_NAME_MAX : INVITE_CODE_LENGTH}
              autoComplete="off"
              autoCapitalize={mode === 'join' ? 'characters' : 'sentences'}
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'private-form-error' : undefined}
            />
            {error && <p id="private-form-error" className="private-form-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? t('common.loading') : mode === 'create' ? t('privateLeague.createCta') : t('privateLeague.joinCta')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
