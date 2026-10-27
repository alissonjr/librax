import { useState } from 'react';
import { setDisplayName } from '../lib/auth';
import { useT, LANGUAGES } from '../i18n';
import { Icon } from '../components/Icon';
import { SoundOnboardingChoice } from '../components/SoundPreference';
import { OnboardingCamera } from '../components/OnboardingCamera';
import { authAvailable } from '../lib/account';
import { DEFAULT_DAILY_GOAL, saveDailyGoal, type ProfileStore } from '../lib/dailyGoal';
import { WelcomeIllustration, Wordmark } from '../components/Brand';
import { LegalConsent } from '../components/LegalLinks';
import { markPolicySeen } from '../lib/usageNotice';
import { track } from '../lib/telemetry';
import '../styles/placement.css';

interface Props {
  /** Perfil local (IdbRepo): a meta diária escolhida fica gravada nele. */
  repo: ProfileStore;
  userId: string;
  /** Fim das boas-vindas; `'placement'` quando a pessoa aceitou o convite do teste de nivelamento. */
  onDone: (next?: 'placement') => void;
  /** Link "Entrar" das boas-vindas (spec-02 12.1), só quando o login existe neste ambiente. */
  onLogin?: () => void;
}

/** Ordem dos passos: idioma, nome, meta (com o som), câmera e o convite do nivelamento. */
const STEPS = ['idioma', 'nome', 'meta', 'camera', 'nivelamento'] as const;
type Step = typeof STEPS[number];

const METAS = [
  { value: 5,  subKey: 'onboarding.metaCasual' },
  { value: 10, subKey: 'onboarding.metaRegular' },
  { value: 20, subKey: 'onboarding.metaDedicado', recommended: true },
  { value: 50, subKey: 'onboarding.metaIntensivo' },
];

export function OnboardingScreen({ repo, userId, onDone, onLogin }: Props) {
  const { t, lang, setLang } = useT();
  const [step, setStep] = useState<Step>('idioma');
  const [name, setName] = useState('');
  const [meta, setMeta] = useState(DEFAULT_DAILY_GOAL);
  const [finishing, setFinishing] = useState(false);
  const stepIndex = STEPS.indexOf(step);

  function advance() {
    setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)]);
  }

  /** O idioma vem do aparelho já marcado; o Continuar grava a escolha (vale também a detectada). */
  function confirmLang() {
    setLang(lang);
    advance();
  }

  // O nome só é gravado no fim: com ele gravado, o onboarding conta como feito (isOnboarded).
  // A meta vai antes, para o mapa já abrir com ela; se o banco local falhar, segue com a padrão.
  async function handleFinish(next?: 'placement') {
    if (finishing) return;
    setFinishing(true);
    await saveDailyGoal(repo, userId, meta).catch(() => {});
    const trimmed = name.trim() || t('common.defaultName');
    setDisplayName(trimmed);
    // Aceitou a política em vigor ao começar (LegalConsent): o aviso dos dados de uso não aparece
    markPolicySeen();
    track({ type: 'onboarding_done', lang, dailyGoal: meta });
    onDone(next);
  }

  return (
    <div className="onboarding">
      {/* Progress dots */}
      <div className="onboarding-dots" aria-hidden="true">
        {STEPS.map((s, i) => (
          <div key={s} className={`onboarding-dot${stepIndex >= i ? ' onboarding-dot--active' : ''}`} />
        ))}
      </div>

      {/* Passo 1: idioma (o do aparelho vem marcado; a tela troca de idioma na hora) */}
      {step === 'idioma' && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <Wordmark size={28} className="onboarding-brand" />
          <h1>{t('onboarding.langTitle')}</h1>
          <p className="onboarding-sub">{t('onboarding.langSub')}</p>
          <div className="onboarding-choices" role="group" aria-label={t('language.select')}>
            {LANGUAGES.map((l, i) => (
              <button
                key={l.code}
                lang={l.code}
                className={`onboarding-choice onboarding-choice--goal animate__animated animate__fadeInUp${lang === l.code ? ' onboarding-choice--selected' : ''}`}
                style={{ animationDelay: `${100 + i * 70}ms` }}
                onClick={() => setLang(l.code)}
                aria-pressed={lang === l.code}
              >
                <span className="onboarding-lang-flag" aria-hidden="true">{l.flag}</span>
                <span className="goal-label">{l.label}</span>
                {lang === l.code && <Icon name="check_circle" filled className="onboarding-choice-check" />}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={confirmLang}>
            {t('common.continue')} <Icon name="arrow_forward" />
          </button>
          {onLogin && authAvailable() && (
            <button className="btn-text" onClick={onLogin}>
              {t('account.haveAccountSignIn')}
            </button>
          )}
        </div>
      )}

      {/* Passo 2: nome */}
      {step === 'nome' && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
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
        </div>
      )}

      {/* Passo 3: meta diária e sons do app */}
      {step === 'meta' && (
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
                aria-pressed={meta === m.value}
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
          <SoundOnboardingChoice />
          <button className="btn btn-primary" onClick={advance}>
            {t('common.continue')} <Icon name="arrow_forward" />
          </button>
        </div>
      )}

      {/* Passo 4: câmera de verdade (permissão e prévia da mão) e privacidade */}
      {step === 'camera' && <OnboardingCamera onNext={advance} />}

      {/* Passo 5: convite do teste de nivelamento. Duas escolhas do mesmo peso; nenhuma é a padrão. */}
      {step === 'nivelamento' && (
        <div className="onboarding-step animate__animated animate__fadeInRight">
          <div className="onboarding-step-icon onboarding-step-icon--hand animate__animated animate__bounceIn">
            <Icon name="sign_language" />
          </div>
          <h2>{t('onboarding.placementTitle')}</h2>
          <p className="onboarding-sub">{t('onboarding.placementSub')}</p>
          <div className="onboarding-choices">
            <button className="onboarding-choice onboarding-choice--goal" onClick={() => handleFinish()} disabled={finishing}>
              <Icon name="play_arrow" filled className="placement-choice-icon" />
              <div>
                <div className="goal-label">{t('onboarding.placementFromStart')}</div>
                <div className="goal-sub">{t('onboarding.placementFromStartSub')}</div>
              </div>
            </button>
            <button className="onboarding-choice onboarding-choice--goal" onClick={() => handleFinish('placement')} disabled={finishing}>
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
