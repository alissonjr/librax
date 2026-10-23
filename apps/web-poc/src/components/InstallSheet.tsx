import { useEffect, useState, useSyncExternalStore } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { getInstallMode, promptInstall, subscribeInstall, type InstallMode } from '../lib/install';

/** Modo de instalação disponível agora (atualiza quando o Chrome libera o pedido ou o app é instalado). */
export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribeInstall, getInstallMode, () => null);
}

interface Props {
  mode: Exclude<InstallMode, null>;
  onClose: () => void;
}

/**
 * Sugestão de instalar o app na tela inicial (decisão 13 do plano). No Android abre o pedido
 * nativo; no iPhone mostra os dois passos do Safari. Sempre com "Agora não".
 */
export function InstallSheet({ mode, onClose }: Props) {
  const { t } = useT();
  const [visible, setVisible] = useState(false);
  // Voltar fecha o sheet (design-system 11.13)
  useCloseOnBack(true, onClose);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  async function handleInstall() {
    await promptInstall().catch(() => false);
    onClose();
  }

  return (
    <div
      className={`streak-sheet-backdrop${visible ? ' streak-sheet-backdrop--visible' : ''}`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-sheet-title"
    >
      <div
        className={`streak-sheet${visible ? ' streak-sheet--open' : ''}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="streak-sheet-handle" />

        <div className="streak-sheet-icon streak-sheet-icon--install">
          <Icon name="mobile_arrow_down" filled />
        </div>

        <h2 className="streak-sheet-title" id="install-sheet-title">{t('install.title')}</h2>
        <p className="streak-sheet-sub">{t('install.sub')}</p>

        {mode === 'ios' && (
          <ol className="install-steps">
            <li className="install-step">
              <span className="install-step-icon"><Icon name="ios_share" /></span>
              <span>{t('install.iosStep1')}</span>
            </li>
            <li className="install-step">
              <span className="install-step-icon"><Icon name="add_box" /></span>
              <span>{t('install.iosStep2')}</span>
            </li>
          </ol>
        )}

        <div className="streak-sheet-actions">
          {mode === 'prompt' ? (
            <>
              <button className="btn btn-primary" onClick={handleInstall}>
                {t('install.install')}
              </button>
              <button className="btn-text-muted" onClick={onClose}>
                {t('install.notNow')}
              </button>
            </>
          ) : (
            // No iPhone a instalação é feita pelo menu do Safari: aqui só fecha
            <button className="btn btn-primary" onClick={onClose}>
              {t('install.understood')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
