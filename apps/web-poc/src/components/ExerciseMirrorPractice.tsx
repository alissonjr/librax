import { useEffect, useRef, useState } from 'react';
import type { Sign } from '../lib/content';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { RecognizedLetterBadge } from './RecognizedLetterBadge';
import type { FingerExtensions } from '../lib/recognizer';
import { useT, type TFunc } from '../i18n';
import { Icon } from './Icon';
import { SignDemo, chooseDemoMode } from './SignDemo';
import { DemoToggle } from './DemoToggle';

const FINGER_LABEL_KEYS = ['fingerThumb', 'fingerIndex', 'fingerMiddle', 'fingerRing', 'fingerPinky'] as const;
const FINGER_KEYS: (keyof FingerExtensions)[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];

function FingerStatus({ extensions, confidence, t }: { extensions: FingerExtensions | null; confidence: number; t: TFunc }) {
  if (!extensions) return null;
  // Mesmas cores do esqueleto (stage.landmark.*): o palco é escuro nos dois modos
  const color = confidence > 0.7 ? 'var(--lx-stage-landmark-ready)' : confidence > 0.4 ? 'var(--lx-stage-landmark-tracking)' : 'var(--lx-stage-landmark-idle)';
  return (
    <div className="finger-status">
      {FINGER_KEYS.map((key, i) => (
        <div
          key={key}
          className={`finger-pip${extensions[key] ? ' finger-pip--up' : ''}`}
          style={{ '--finger-color': color } as React.CSSProperties}
        >
          {t(`exerciseMirrorPractice.${FINGER_LABEL_KEYS[i]}`)}
        </div>
      ))}
    </div>
  );
}

interface Props {
  sign: Sign;
  onComplete: () => void;
}

export function ExerciseMirrorPractice({ sign, onComplete }: Props) {
  const { t } = useT();
  // Esqueleto 2D sobre o vídeo (o avatar 3D saiu do MVP)
  const { videoRef, canvasRef, status, rawGesture, stableGesture, handPresent, confidence, extensions, start, stop } = useCameraRecognizer();
  const [practiced, setPracticed] = useState(false);
  // Referência sob demanda: o avatar e a detecção da mão disputam a GPU, então a câmera
  // para enquanto o sinal é mostrado e volta quando a referência fecha.
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const hasDemo = chooseDemoMode(sign) !== 'text';

  useEffect(() => { start(); }, []);

  useEffect(() => {
    if (showDemo) { demoShownRef.current = true; return; }
    // Fechou a referência: o avatar já pausou ao desmontar, então a câmera pode voltar
    if (demoShownRef.current) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo]);

  // A câmera terminou de iniciar com a referência aberta (permissão ou modelo demoraram): para de novo
  useEffect(() => {
    if (showDemo && status === 'active') stop();
  }, [showDemo, status, stop]);

  function openDemo() {
    stop();
    setShowDemo(true);
  }

  function handleReady() {
    setPracticed(true);
    onComplete();
  }

  return (
    <div className="exercise-screen cam-sign-layout">
      <div className="cam-sign-target animate__animated animate__fadeInDown animate__faster">
        <div className="cam-sign-prompt">{t('exerciseMirrorPractice.prompt')}</div>
        <div className="cam-sign-letter cam-sign-letter--hand animate__animated animate__bounceIn" style={{ animationDelay: '120ms' }}>{sign.gloss}</div>
        <p className="cam-sign-caption">{sign.video_caption}</p>
        <p className="mirror-note">{t('exerciseMirrorPractice.note')}</p>
        {hasDemo && (
          <DemoToggle showDemo={showDemo} onOpen={openDemo} onClose={() => setShowDemo(false)} />
        )}
      </div>

      {showDemo && (
        <div className="cam-sign-demo">
          <SignDemo sign={sign} fallback={null} />
          <p className="cam-sign-demo-note">{t('signDemo.cameraPaused')}</p>
        </div>
      )}

      <div className={`cam-sign-viewport-wrap${showDemo ? ' hidden' : ''}`}>
        {(status === 'idle' || status === 'loading') && (
          <div className="cam-sign-placeholder">
            <Icon name={status === 'loading' ? 'progress_activity' : 'videocam'} spin={status === 'loading'} />
            <p>{status === 'loading' ? t('common.loading') : t('exerciseMirrorPractice.starting')}</p>
          </div>
        )}
        {(status === 'denied' || status === 'error') && (
          <div className="cam-sign-placeholder cam-sign-placeholder--error">
            <Icon name="videocam_off" />
            <p>{t('exerciseMirrorPractice.cameraUnavailable')}</p>
            <button className="btn btn-secondary btn-sm" onClick={start}>{t('exerciseMirrorPractice.retry')}</button>
          </div>
        )}
        <div className={`cam-sign-viewport${status === 'active' ? '' : ' hidden'}`}>
          <video ref={videoRef} className="camera-video" playsInline muted aria-label={t('exerciseMirrorPractice.cameraFeed')} />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
          <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />
          <RecognizedLetterBadge letter={rawGesture} confidence={confidence} />
        </div>

        {status === 'active' && handPresent && (
          <div className="cam-sign-feedback">
            <FingerStatus extensions={extensions} confidence={confidence} t={t} />
            {stableGesture && (
              <span className="cam-sign-hint">{t('exerciseMirrorPractice.detected', { gesture: stableGesture })}</span>
            )}
            {confidence > 0 && (
              <div className="gesture-bar cam-sign-bar">
                <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      <button
        className="btn btn-primary"
        onClick={handleReady}
      >
        <Icon name="check" /> {t('exerciseMirrorPractice.ready')}
      </button>
    </div>
  );
}
