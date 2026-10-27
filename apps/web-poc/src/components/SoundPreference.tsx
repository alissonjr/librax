import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { getSoundPref, isSoundEnabled, onSoundPrefChange, setSoundEnabled, type SoundPref } from '../lib/sound';
import '../styles/sound.css';

/**
 * Item "Sons" das Configurações: interruptor sempre visível (plano mobile web, decisão 12).
 * O texto diz o estado ("Ligados"/"Desligados"), não só a posição do interruptor.
 */
export function SoundSettingItem() {
  const { t } = useT();
  const [enabled, setEnabled] = useState(isSoundEnabled);

  useEffect(() => onSoundPrefChange(setEnabled), []);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="settings-item settings-item--btn sound-setting"
      onClick={() => setSoundEnabled(!enabled)}
    >
      <Icon name={enabled ? 'volume_up' : 'volume_off'} className="settings-item-icon" />
      <span className="settings-item-text">
        <span className="settings-item-label">{t('settings.sound')}</span>
        <span className="settings-item-value">
          {enabled ? t('settings.soundOn') : t('settings.soundOff')}. {t('settings.soundHint')}
        </span>
      </span>
      <span className={`sound-switch${enabled ? ' sound-switch--on' : ''}`} aria-hidden="true">
        <span className="sound-switch-thumb" />
      </span>
    </button>
  );
}

/**
 * Pergunta do onboarding (design system, "Decisões aplicadas" item 4), no passo da meta diária
 * (a pergunta do motivo saiu). Nada vem marcado; sem escolha, o som fica desligado e pode ser
 * ligado depois em Configurações.
 */
export function SoundOnboardingChoice() {
  const { t } = useT();
  const [pref, setPref] = useState<SoundPref | null>(getSoundPref);

  function choose(on: boolean) {
    setSoundEnabled(on);
    setPref(on ? 'on' : 'off');
  }

  return (
    <div className="sound-choice" role="group" aria-labelledby="sound-choice-title">
      <p id="sound-choice-title" className="sound-choice-title">{t('onboarding.soundTitle')}</p>
      <p className="sound-choice-sub">{t('onboarding.soundSub')}</p>
      <div className="sound-choice-options">
        <button
          type="button"
          className={`sound-choice-btn${pref === 'on' ? ' sound-choice-btn--selected' : ''}`}
          aria-pressed={pref === 'on'}
          onClick={() => choose(true)}
        >
          <Icon name="volume_up" /> {t('onboarding.soundOn')}
        </button>
        <button
          type="button"
          className={`sound-choice-btn${pref === 'off' ? ' sound-choice-btn--selected' : ''}`}
          aria-pressed={pref === 'off'}
          onClick={() => choose(false)}
        >
          <Icon name="volume_off" /> {t('onboarding.soundOff')}
        </button>
      </div>
    </div>
  );
}
