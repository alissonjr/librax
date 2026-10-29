import { useT } from '../i18n';
import { Icon } from './Icon';

interface Props {
  /** Texto do porquê: cada liga explica o que a conta libera nela. */
  text: string;
  onCreateAccount: () => void;
  onLogin: () => void;
}

/**
 * Convite para criar conta nas ligas (semana, geral e privadas): o ranking é com pessoas de
 * verdade e fica no servidor, então só existe com conta. Sem ranking inventado para convidado.
 */
export function SocialAccountInvite({ text, onCreateAccount, onLogin }: Props) {
  const { t } = useT();
  return (
    <div className="social-invite">
      <Icon name="group" className="social-invite-icon" />
      <h2 className="social-invite-title">{t('social.inviteTitle')}</h2>
      <p className="social-invite-text">{text}</p>
      <div className="social-invite-actions">
        <button className="btn btn-primary" onClick={onCreateAccount}>{t('social.inviteCreate')}</button>
        <button className="btn btn-secondary" onClick={onLogin}>{t('social.inviteLogin')}</button>
      </div>
    </div>
  );
}

/** Sem conexão (ou o servidor não respondeu): o ranking só existe online. */
export function SocialOffline({ onRetry }: { onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className="social-invite">
      <Icon name="cloud_off" className="social-invite-icon" />
      <h2 className="social-invite-title">{t('social.offlineTitle')}</h2>
      <p className="social-invite-text">{t('social.offlineText')}</p>
      <div className="social-invite-actions">
        <button className="btn btn-secondary" onClick={onRetry}>{t('social.retry')}</button>
      </div>
    </div>
  );
}
