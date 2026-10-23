import { useEffect } from 'react';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { warmUpHandLandmarker } from '../recognition/landmarker';
import { RecognizedLetterBadge } from '../components/RecognizedLetterBadge';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';

const LETTER_HINTS: Record<string, string> = {
  A: 'A - punho fechado, polegar ao lado',
  B: 'B - quatro dedos juntos, polegar dobrado',
  D: 'D - so o indicador estendido',
  F: 'F - polegar + indicador se tocam, tres dedos em pe',
  I: 'I - so o minimo estendido',
  L: 'L - polegar + indicador formando L',
  U: 'U - indicador + medio juntos, em pe',
  V: 'V - indicador + medio (paz)',
  W: 'W - tres dedos abertos',
  Y: 'Y - polegar + minimo (shaka)',
};

export function CameraScreen() {
  const { t } = useT();
  // Esqueleto 2D sobre o vídeo (o avatar 3D saiu do MVP; o código dele fica, desligado)
  const { videoRef, canvasRef, status, rawGesture, stableGesture, handPresent, confidence, start } =
    useCameraRecognizer();

  // Tela só de câmera: começa a carregar o modelo antes do toque em "Ativar"
  useEffect(() => { warmUpHandLandmarker(); }, []);

  return (
    <div className="camera-screen">
      <header className="screen-header animate__animated animate__fadeInDown animate__faster">
        <h1 className="screen-title">{t('cameraScreen.title')}</h1>
        <p className="screen-subtitle">
          {t('cameraScreen.subtitle')}
        </p>
      </header>

      {status === 'idle' && (
        <div className="camera-idle animate__animated animate__fadeIn">
          <div className="camera-idle-icon wow-glow animate__animated animate__bounceIn">
            <Icon name="videocam" />
          </div>
          <p>{t('cameraScreen.idle')}</p>
          <button className="btn btn-primary btn-inline" onClick={start}>
            <Icon name="videocam" /> {t('cameraScreen.activate')}
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="camera-idle">
          <div className="camera-idle-icon">
            <Icon name="progress_activity" spin />
          </div>
          <p>{t('cameraScreen.loadingModel')}</p>
        </div>
      )}

      {(status === 'denied' || status === 'error') && (
        <div className="camera-idle camera-idle--error animate__animated animate__fadeIn">
          <div className="camera-idle-icon animate__animated animate__headShake">
            <Icon name="videocam_off" />
          </div>
          <p>
            {status === 'denied'
              ? t('cameraScreen.denied')
              : t('cameraScreen.error')}
          </p>
          <button className="btn btn-primary btn-inline" onClick={start}>{t('cameraScreen.retry')}</button>
        </div>
      )}

      <div className={`camera-area${status === 'active' ? '' : ' camera-area--hidden'}`}>
        <div className="camera-viewport">
          <video ref={videoRef} className="camera-video" playsInline muted aria-label={t('cameraScreen.feedLabel')} />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
          <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />
          <RecognizedLetterBadge letter={rawGesture} confidence={confidence} />
        </div>

        <div className="gesture-panel">
          {handPresent ? (
            stableGesture ? (
              <div className="gesture-result gesture-result--found animate__animated animate__bounceIn animate__faster">
                <div key={stableGesture} className="gesture-letter animate__animated animate__bounceIn">{stableGesture}</div>
                <div className="gesture-hint">{LETTER_HINTS[stableGesture] ?? stableGesture}</div>
                <div className="gesture-bar">
                  <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
                </div>
                <div className="gesture-confidence">{t('cameraScreen.match', { count: Math.round(confidence * 100) })}</div>
              </div>
            ) : (
              <div className="gesture-result gesture-result--searching">
                <Icon name="sign_language" className="gesture-searching-icon" />
                <p>{t('cameraScreen.handDetected')}</p>
                <div className="gesture-bar">
                  <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
                </div>
              </div>
            )
          ) : (
            <div className="gesture-result gesture-result--none">
              <Icon name="sign_language" className="gesture-none-icon" />
              <p>{t('cameraScreen.positionHand')}</p>
            </div>
          )}

          <div className="gesture-help">
            <p className="gesture-help-title">{t('cameraScreen.recognizableLetters')}</p>
            <div className="gesture-help-letters">
              {Object.keys(LETTER_HINTS).map(l => (
                <span key={l} className={`gesture-chip${stableGesture === l ? ' gesture-chip--active' : ''}`}>
                  {l}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
