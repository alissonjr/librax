import { useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { showInGlobalRanking, setShowInGlobalRanking } from '../lib/social';
import '../styles/sound.css';

/**
 * "Aparecer na liga geral" nas Configurações (só com conta), ligado por padrão. Desligado, o nome
 * sai da liga geral para todo mundo; a pessoa continua vendo a lista. Mesmo interruptor do som.
 */
export function GlobalRankingSettingItem({ onFail }: { onFail: () => void }) {
  const { t } = useT();
  const [enabled, setEnabled] = useState(showInGlobalRanking);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const next = !enabled;
    setBusy(true);
    setEnabled(next);
    const saved = await setShowInGlobalRanking(next);
    setBusy(false);
    if (saved === null) {
      setEnabled(!next);
      onFail();
    } else setEnabled(saved);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-busy={busy || undefined}
      className="settings-item settings-item--btn sound-setting"
      onClick={toggle}
    >
      <Icon name="military_tech" className="settings-item-icon" />
      <span className="settings-item-text">
        <span className="settings-item-label">{t('settings.globalRanking')}</span>
        <span className="settings-item-value">
          {enabled ? t('settings.globalRankingOn') : t('settings.globalRankingOff')}
        </span>
      </span>
      <span className={`sound-switch${enabled ? ' sound-switch--on' : ''}`} aria-hidden="true">
        <span className="sound-switch-thumb" />
      </span>
    </button>
  );
}
