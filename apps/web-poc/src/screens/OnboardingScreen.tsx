import { useState } from 'react';
import { setDisplayName } from '../lib/auth';
import { useT, LANGUAGES } from '../i18n';
import { Icon } from '../components/Icon';
import { SoundOnboardingChoice } from '../components/SoundPreference';
import { authAvailable } from '../lib/account';
import { WelcomeIllustration, Wordmark } from '../components/Brand';
import { LegalConsent } from '../components/LegalLinks';
import '../styles/placement.css';

interface Props {
  /** Fim das boas-vindas; `'placement'` quando a pessoa aceitou o convite do teste de nivelamento. */
  onDone: (next?: 'placement') => void;
  /** Link "Entrar" das boas-vindas (spec-02 12.1), só quando o login existe neste ambiente. */
  onLogin?: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

const MOTIVOS = [
  { id: 'familiar', key: 'onboarding.motivoFamiliar' },
  { id: 'interesse', key: 'onboarding.motivoInteresse' },
  { id: 'trabalho', key: 'onboarding.motivoTrabalho' },
  { id: 'surdo', key: 'onboarding.motivoSurdo' },
  { id: 'outro', key: 'onboarding.motivoOutro' },
];

const METAS = [
  { value: 5,  subKey: 'onboarding.metaCasual' },
  { value: 10, subKey: 'onboarding.metaRegular' },
  { value: 20, subKey: 'onboarding.metaDedicado', recommended: true },
  { value: 50, subKey: 'onboarding.metaIntensivo' },
];

export function OnboardingScreen({ onDone, onLogin }: Props) {
  const { t, lang, setLang } = useT();
  const [step, setStep] = useState<Step>(1);
  const [name, setName] = useState('');
  const [motivo, setMotivo] = useState('');
  const [meta, setMeta] = useState(20);

  function advance() {
    setStep(s => Math.min(5, s + 1) as Step);
  }

  // O nome só é gravado no fim: com ele gravado, o onboarding conta como feito (isOnboarded)
  function handleFinish(next?: 'placement') {
    const trimmed = name.trim() || t('common.defaultName');
    setDisplayName(trimmed);
    onDone(next);
  }

  return (
    <div className="onboarding">
      {/* Language selector */}
      <div className="onboarding-lang" role="group" aria-label={t('language.select')}>
        {LANGUAGES.map(l => (
          <button
            key={l.code}
            className={`onboarding-lang-btn${lang === l.code ? ' onboarding-lang-btn--active' : ''}`}
            onClick={() => setLang(l.code)}
            aria-pressed={lang === l.code}
          >
            <span className="onboarding-lang-flag">{l.flag}</span>
            <span>{l.label}</span>
          </button>
        ))}
      </div>

      {/* Progress dots */}
      <div className="onboarding-dots">
        {([1, 2, 3, 4, 5] as Step[]).map(s => (
          <div key={s} className={`onboarding-dot${step >= s ? ' onboarding-dot--active' : ''}`} />
        ))}
      </div>

      {/* Step 1: Nome */}
      {step === 1 && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <Wordmark size={28} className="onboarding-brand" />
          <div className="onboarding-hero animate__animated animate__fadeIn">
            <WelcomeIllustration />
          </div>
          <h1>{t('onboarding.welcomeTitle')}</h1>
          <p className="onboarding-sub">
            {t('onboarding.welcomeSub')}
          </p>
          <div className="onboarding-field">
            <input
              type="text"
              className="onboarding-input"
              placeholder={t('onboarding.namePlaceholder')}
              autoComplete="given-name"
              maxLength={30}
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && advance()}
            />
          </div>
          <button className="btn btn-primary" onClick={advance}>
            {t('onboarding.start')} <Icon name="arrow_forward" />
          </button>
          <p className="onboarding-disclaimer">
            {t('onboarding.noAccount')}
          </p>
          <LegalConsent messageKey="legal.onboardingConsent" />
          {onLogin && authAvailable() && (
            <button className="btn-text" onClick={onLogin}>
              {t('account.haveAccountSignIn')}
            </button>
          )}
        </div>
      )}

      {/* Step 2: Motivo */}
      {step === 2 && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <div className="onboarding-step-icon animate__animated animate__bounceIn">
            <Icon name="local_fire_department" filled />
          </div>
          <h2>{t('onboarding.motivoTitle')}</h2>
          <p className="onboarding-sub">{t('onboarding.motivoSub')}</p>
          <div className="onboarding-choices">
            {MOTIVOS.map((m, i) => (
              <button
                key={m.id}
                className={`onboarding-choice animate__animated animate__fadeInUp${motivo === m.id ? ' onboarding-choice--selected' : ''}`}
                style={{ animationDelay: `${100 + i * 70}ms` }}
                onClick={() => setMotivo(m.id)}
              >
                {t(m.key)}
              </button>
            ))}
          </div>
          <SoundOnboardingChoice />
          <button className="btn btn-primary" onClick={advance} disabled={!motivo}>
            {t('common.continue')} <Icon name="arrow_forward" />
          </button>
        </div>
      )}

      {/* Step 3: Meta diária */}
      {step === 3 && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <div className="onboarding-step-icon animate__animated animate__bounceIn">
            <Icon name="flag" />
          </div>
          <h2>{t('onboarding.metaTitle')}</h2>
          <p className="onboarding-sub">{t('onboarding.metaSub')}</p>
          <div className="onboarding-choices">
            {METAS.map((m, i) => (
              <button
                key={m.value}
                className={`onboarding-choice onboarding-choice--goal animate__animated animate__fadeInUp${meta === m.value ? ' onboarding-choice--selected' : ''}`}
                style={{ animationDelay: `${100 + i * 70}ms` }}
                onClick={() => setMeta(m.value)}
              >
                <Icon name="bolt" filled className="goal-icon" />
                <div>
                  <div className="goal-label">{t('onboarding.metaXpPerDay', { xp: m.value })}</div>
                  <div className="goal-sub">{t(m.subKey)}</div>
                </div>
                {m.recommended && <span className="goal-badge">{t('common.recommended')}</span>}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={advance}>
            {t('common.continue')} <Icon name="arrow_forward" />
          </button>
        </div>
      )}

      {/* Step 4: Câmera + LGPD */}
      {step === 4 && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <div className="onboarding-step-icon onboarding-step-icon--hand wow-glow animate__animated animate__bounceIn">
            <Icon name="videocam" />
          </div>
          <h2>{t('onboarding.cameraTitle')}</h2>
          <p className="onboarding-sub">
            {t('onboarding.cameraSub')}
          </p>
          <div className="onboarding-privacy-card">
            <Icon name="shield" className="privacy-icon" />
            <p>
              <strong>{t('onboarding.privacyStrong')}</strong> {t('onboarding.privacyText')}
            </p>
          </div>
          <div className="onboarding-camera-actions">
            <button className="btn btn-primary" onClick={advance}>
              <Icon name="videocam" /> {t('onboarding.useCamera')}
            </button>
            <button className="btn btn-ghost" onClick={advance}>
              {t('onboarding.notNow')}
            </button>
          </div>
          <p className="onboarding-disclaimer">
            {t('onboarding.cameraDisclaimer')}
          </p>
        </div>
      )}

      {/* Step 5: convite do teste de nivelamento. Duas escolhas do mesmo peso; nenhuma é a padrão. */}
      {step === 5 && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <div className="onboarding-step-icon onboarding-step-icon--hand animate__animated animate__bounceIn">
            <Icon name="sign_language" />
          </div>
          <h2>{t('onboarding.placementTitle')}</h2>
          <p className="onboarding-sub">{t('onboarding.placementSub')}</p>
          <div className="onboarding-choices">
            <button className="onboarding-choice onboarding-choice--goal" onClick={() => handleFinish()}>
              <Icon name="play_arrow" filled className="placement-choice-icon" />
              <div>
                <div className="goal-label">{t('onboarding.placementFromStart')}</div>
                <div className="goal-sub">{t('onboarding.placementFromStartSub')}</div>
              </div>
            </button>
            <button className="onboarding-choice onboarding-choice--goal" onClick={() => handleFinish('placement')}>
              <Icon name="skip_next" className="placement-choice-icon" />
              <div>
                <div className="goal-label">{t('onboarding.placementTest')}</div>
                <div className="goal-sub">{t('onboarding.placementTestSub')}</div>
              </div>
            </button>
          </div>
          <p className="onboarding-disclaimer">{t('onboarding.placementLater')}</p>
        </div>
      )}
    </div>
  );
}
