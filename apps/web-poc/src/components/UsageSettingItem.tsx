import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { isTelemetryEnabled, setTelemetryEnabled, subscribeTelemetry } from '../lib/telemetry';
import '../styles/sound.css';

/**
 * "Enviar dados de uso anônimos" nas Configurações (lib/telemetry.ts), ligado por padrão. Desligar
 * para de mandar, apaga a fila e o código deste aparelho e pede ao servidor para apagar a cópia.
 * Mesmo interruptor do som: o texto diz o estado, não só a posição.
 */
export function UsageSettingItem() {
  const { t } = useT();
  const [enabled, setEnabled] = useState(isTelemetryEnabled);

  useEffect(() => subscribeTelemetry(() => setEnabled(isTelemetryEnabled())), []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="settings-item settings-item--btn sound-setting"
      onClick={() => setTelemetryEnabled(!enabled)}
    >
      <Icon name="query_stats" className="settings-item-icon" />
      <span className="settings-item-text">
        <span className="settings-item-label">{t('settings.usageData')}</span>
        <span className="settings-item-value">
          {enabled ? t('settings.usageDataOn') : t('settings.usageDataOff')}. {t('settings.usageDataHint')}
        </span>
      </span>
      <span className={`sound-switch${enabled ? ' sound-switch--on' : ''}`} aria-hidden="true">
        <span className="sound-switch-thumb" />
      </span>
    </button>
  );
}
