import { useEffect, useRef, useState } from 'react';
import type { Sign } from '../lib/content';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { RecognizedLetterBadge } from './RecognizedLetterBadge';
import type { FingerExtensions } from '../lib/recognizer';
import { Flags } from '../lib/flags';
import { Haptics } from '../lib/haptics';
import { launchConfetti } from '../lib/confetti';
import { useT, type TFunc } from '../i18n';
import { Icon } from './Icon';
import { SignDemo, chooseDemoMode } from './SignDemo';
import { DemoToggle } from './DemoToggle';

export const RECOGNIZABLE_LETTERS = new Set(['A', 'B', 'D', 'F', 'I', 'L', 'U', 'V', 'W', 'Y']);

function MomentoZeroOverlay({ onDismiss, t }: { onDismiss: () => void; t: TFunc }) {
  return (
    <div className="momento-zero-overlay" onClick={onDismiss} role="dialog" aria-modal="true">
      <div className="momento-zero-card">
        <div className="momento-zero-icon">
          <Icon name="sign_language" filled size="64px" />
        </div>
        <h2 className="momento-zero-title">{t('exerciseCameraSign.seesYourHand')}</h2>
        <p className="momento-zero-sub">
          {t('exerciseCameraSign.seesYourHandSub')}
        </p>
        <button className="btn btn-primary" onClick={onDismiss}>
          {t('exerciseCameraSign.letsStart')}
        </button>
      </div>
    </div>
  );
}

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
          title={key}
        >
          {t(`exerciseCameraSign.${FINGER_LABEL_KEYS[i]}`)}
        </div>
      ))}
    </div>
  );
}

interface Props {
  sign: Sign;
  onComplete: (correct: boolean) => void;
}

export function ExerciseCameraSign({ sign, onComplete }: Props) {
  const { t } = useT();
  // Esqueleto 2D sobre o vídeo da própria pessoa (decisão 5 do plano mobile web): o avatar 3D saiu do MVP
  const { videoRef, canvasRef, status, rawGesture, stableGesture, handPresent, confidence, extensions, start, stop } =
    useCameraRecognizer();

  const [succeeded, setSucceeded] = useState(false);
  // Dica sob demanda: o avatar não roda junto com a detecção (os dois disputam a GPU).
  // A câmera para ao abrir a dica e volta ao fechar.
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const hasDemo = chooseDemoMode(sign) !== 'text';
  const [showMomentoZero, setShowMomentoZero] = useState(false);
  const momentoShownRef = useRef(false);
  const targetLetter = sign.gloss;
  const isRecognizable = RECOGNIZABLE_LETTERS.has(targetLetter);

  useEffect(() => {
    if (handPresent && !momentoShownRef.current && !Flags.firstCameraSuccess()) {
      momentoShownRef.current = true;
      Flags.setFirstCameraSuccess();
      Haptics.achievement();
      setShowMomentoZero(true);
    }
  }, [handPresent]);

  useEffect(() => {
    if (!succeeded && stableGesture === targetLetter) {
      setSucceeded(true);
      Haptics.correctCamera();
      launchConfetti();
    }
  }, [stableGesture, targetLetter, succeeded]);

  useEffect(() => {
    if (isRecognizable) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showDemo) { demoShownRef.current = true; return; }
    // Dica fechada: o avatar já pausou ao desmontar, então a câmera pode voltar
    if (demoShownRef.current) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo]);

  // A câmera terminou de iniciar com a dica aberta (permissão ou modelo demoraram): para de novo
  useEffect(() => {
    if (showDemo && status === 'active') stop();
  }, [showDemo, status, stop]);

  function openDemo() {
    stop();
    setShowDemo(true);
  }

  if (!isRecognizable) {
    return (
      <div className="exercise-screen">
        <div className="cam-sign-target">
          <div className="cam-sign-prompt">{t('exerciseCameraSign.practiceSign')}</div>
          <div className="cam-sign-letter">{targetLetter}</div>
          <p className="cam-sign-caption">{sign.video_caption}</p>
        </div>
        <div className="cam-sign-unrecognizable">
          <Icon name="sign_language" />
          <p>
            {t('exerciseCameraSign.notAvailable', { gesture: targetLetter })}
          </p>
          <button className="btn btn-primary" onClick={() => onComplete(false)}>
            {t('common.continue')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="exercise-screen cam-sign-layout">
      {showMomentoZero && <MomentoZeroOverlay onDismiss={() => setShowMomentoZero(false)} t={t} />}

      <div className="cam-sign-target animate__animated animate__fadeInDown animate__faster">
        <div className="cam-sign-prompt">{t('exerciseCameraSign.makeSign')}</div>
        <div className="cam-sign-letter animate__animated animate__bounceIn" style={{ animationDelay: '120ms' }}>{targetLetter}</div>
        <p className="cam-sign-caption">{sign.video_caption}</p>
        {hasDemo && !succeeded && (
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
        {succeeded && (
          <div
            className="cam-sign-success-overlay animate__animated animate__fadeIn animate__faster"
            role="dialog"
            aria-modal="true"
            aria-label={t('exerciseCameraSign.correct')}
          >
            <div className="cam-sign-success-card animate__animated animate__bounceIn">
              <Icon name="check" size="40px" className="cam-sign-success-check" />
              <p className="cam-sign-success-title">
                {t('exerciseCameraSign.successTitle', { letter: targetLetter })}
              </p>
              <button className="btn btn-primary" onClick={() => onComplete(true)} autoFocus>
                {t('exerciseCameraSign.nextLetter')} <Icon name="skip_next" />
              </button>
            </div>
          </div>
        )}

        {(status === 'idle' || status === 'loading') && (
          <div className="cam-sign-placeholder">
            <Icon name={status === 'loading' ? 'progress_activity' : 'videocam'} spin={status === 'loading'} />
            <p>{status === 'loading' ? t('exerciseCameraSign.loadingCamera') : t('exerciseCameraSign.starting')}</p>
          </div>
        )}

        {(status === 'denied' || status === 'error') && (
          <div className="cam-sign-placeholder cam-sign-placeholder--error">
            <Icon name="videocam_off" />
            <p>{t('exerciseCameraSign.cameraUnavailable')}</p>
            <button className="btn btn-secondary btn-sm" onClick={start}>{t('exerciseCameraSign.retry')}</button>
          </div>
        )}

        <div className={`cam-sign-viewport${status === 'active' ? '' : ' hidden'}`}>
          <video
            ref={videoRef}
            className="camera-video"
            playsInline
            muted
            aria-label={t('exerciseCameraSign.cameraFeed')}
          />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
          {/* Guia de enquadramento: por enquanto só a zona da mão (o rosto entra da U3 em diante) */}
          {!succeeded && (
            <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />
          )}
          <RecognizedLetterBadge letter={rawGesture} confidence={confidence} />
        </div>

        {status === 'active' && (
          <div className="cam-sign-feedback">
            {!handPresent && (
              <span className="cam-sign-hint"><Icon name="sign_language" /> {t('exerciseCameraSign.positionHand')}</span>
            )}
            {handPresent && !succeeded && stableGesture && stableGesture !== targetLetter && (
              <span className="cam-sign-hint cam-sign-hint--wrong">
                <Icon name="lightbulb" filled /> {t('exerciseCameraSign.detectedAdjust', { gesture: stableGesture })}
              </span>
            )}
            {handPresent && !succeeded && !stableGesture && (
              <span className="cam-sign-hint cam-sign-hint--tracking">{t('exerciseCameraSign.handDetected')}</span>
            )}

            {handPresent && (
              <FingerStatus extensions={extensions} confidence={confidence} t={t} />
            )}

            {handPresent && confidence > 0 && (
              <div className="gesture-bar cam-sign-bar">
                <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {!succeeded && (
        <button
          className="btn btn-ghost cam-sign-skip"
          onClick={() => onComplete(false)}
          aria-label={t('exerciseCameraSign.skipExercise')}
        >
          <Icon name="skip_next" /> {t('common.skip')}
        </button>
      )}
    </div>
  );
}
