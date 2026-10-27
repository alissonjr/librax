import { useState } from 'react';
import { useT } from '../i18n';
import { Icon, type IconName } from './Icon';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';

interface Props {
  /** Segue para o próximo passo das boas-vindas (com ou sem câmera). */
  onNext: () => void;
}

/** O que o passo mostra: antes do toque, pedindo, vídeo ao vivo, recusada ou sem câmera. */
type View = 'idle' | 'asking' | 'active' | 'denied' | 'unavailable';

/**
 * Passo da câmera das boas-vindas. "Usar câmera" pede a permissão na hora e mostra uma prévia
 * curta com os pontos da mão (o mesmo useCameraRecognizer dos exercícios, com `cameraFirst`: o
 * vídeo não espera o modelo, que chega depois). Recusa, aparelho sem câmera e modelo demorando
 * nunca prendem a pessoa: o "Continuar" está sempre ali. "Agora não" segue sem pedir nada.
 * Sair do passo desmonta o componente, e o hook desliga a câmera.
 */
export function OnboardingCamera({ onNext }: Props) {
  const { t } = useT();
  const cam = useCameraRecognizer({ cameraFirst: true });
  const [requested, setRequested] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  function requestCamera() {
    setRequested(true);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setUnsupported(true);
      return;
    }
    void cam.start();
  }

  const view: View = !requested
    ? 'idle'
    : unsupported || cam.status === 'error'
      ? 'unavailable'
      : cam.status === 'denied'
        ? 'denied'
        : cam.status === 'active'
          ? 'active'
          : 'asking';

  const live: { icon: IconName; text: string; spin?: boolean } = cam.modelStatus === 'error'
    ? { icon: 'info', text: t('onboarding.cameraModelError') }
    : cam.modelStatus !== 'ready'
      ? { icon: 'progress_activity', text: t('onboarding.cameraModelLoading'), spin: true }
      : cam.handPresent
        ? { icon: 'check_circle', text: t('onboarding.cameraHandFound') }
        : { icon: 'sign_language', text: t('onboarding.cameraShowHand') };

  return (
    <div className="onboarding-step animate__animated animate__fadeInRight">
      <div className="onboarding-step-icon onboarding-step-icon--hand wow-glow animate__animated animate__bounceIn">
        <Icon name="videocam" />
      </div>
      <h2>{t('onboarding.cameraTitle')}</h2>
      <p className="onboarding-sub">{t('onboarding.cameraSub')}</p>

      {/* O vídeo fica sempre montado (o iPhone só toca o stream num <video> renderizado) */}
      <div className={`onboarding-camera${view === 'active' ? '' : ' camera-area--hidden'}`}>
        <video
          ref={cam.videoRef}
          className="camera-video"
          playsInline
          muted
          aria-label={t('cameraScreen.feedLabel')}
        />
        <canvas ref={cam.canvasRef} className="camera-canvas" aria-hidden="true" />
        {view === 'active' && (
          <p
            className={`onboarding-camera-pill${cam.handPresent && cam.modelStatus === 'ready' ? ' onboarding-camera-pill--ok' : ''}`}
            role="status"
          >
            <Icon name={live.icon} spin={live.spin} filled={live.icon === 'check_circle'} />
            <span>{live.text}</span>
          </p>
        )}
      </div>

      {view === 'asking' && (
        <p className="onboarding-camera-msg" role="status">
          <Icon name="progress_activity" spin />
          <span>{t('onboarding.cameraAsking')}</span>
        </p>
      )}
      {(view === 'denied' || view === 'unavailable') && (
        <div className="onboarding-camera-msg onboarding-camera-msg--off" role="status">
          <Icon name="videocam_off" />
          <span>{view === 'denied' ? t('onboarding.cameraDenied') : t('onboarding.cameraUnavailable')}</span>
        </div>
      )}

      <div className="onboarding-privacy-card">
        <Icon name="shield" className="privacy-icon" />
        <p>
          <strong>{t('onboarding.privacyStrong')}</strong> {t('onboarding.privacyText')}
        </p>
      </div>

      <div className="onboarding-camera-actions">
        {view === 'idle' ? (
          <>
            <button className="btn btn-primary" onClick={requestCamera}>
              <Icon name="videocam" /> {t('onboarding.useCamera')}
            </button>
            <button className="btn btn-ghost" onClick={onNext}>
              {t('onboarding.notNow')}
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-primary" onClick={onNext}>
              {t('common.continue')} <Icon name="arrow_forward" />
            </button>
            {(view === 'denied' || (view === 'unavailable' && !unsupported)) && (
              <button className="btn btn-ghost" onClick={requestCamera}>
                {t('cameraScreen.retry')}
              </button>
            )}
          </>
        )}
      </div>
      <p className="onboarding-disclaimer">{t('onboarding.cameraDisclaimer')}</p>
    </div>
  );
}
