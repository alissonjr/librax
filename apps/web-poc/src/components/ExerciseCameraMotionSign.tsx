import { useEffect, useRef, useState } from 'react';
import type { Sign } from '../lib/content';
import { useSignCameraRecognizer } from '../hooks/useSignCameraRecognizer';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { launchConfetti } from '../lib/confetti';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { SignDemo, chooseDemoMode } from './SignDemo';
import { DemoToggle } from './DemoToggle';
import { TraceCameraArcs } from './Brand';
import { CameraRun, saveCameraRun } from '../lib/cameraStats';

interface Props {
  sign: Sign;
  onComplete: (correct: boolean) => void;
}

/**
 * perform_sign de sinal com movimento (palavras como ARROZ e MESA), quando o modelo de sinais
 * publicado em /ml/sinais/ conhece a glosa (src/lib/content.ts decide). Mãos e corpo pela
 * câmera, avaliados em janelas de 1 a 2 s; acerta quando a leitura confirmada (a mesma glosa em
 * duas avaliações seguidas, useSignCameraRecognizer) é a glosa do exercício.
 * As letras continuam no ExerciseCameraSign.
 */
export function ExerciseCameraMotionSign({ sign, onComplete }: Props) {
  const { t } = useT();
  const gloss = sign.gloss;
  const { videoRef, canvasRef, status, handPresent, bodyPresent, gloss: read, targetProbability, start, stop } =
    useSignCameraRecognizer(gloss);

  const [succeeded, setSucceeded] = useState(false);
  // Dica sob demanda: o avatar e a detecção disputam a GPU, então a câmera para enquanto ela abre
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const hasDemo = chooseDemoMode(sign) !== 'text';
  // Última leitura de outro sinal, para a dica "Vimos X" não piscar entre as avaliações
  const [lastOther, setLastOther] = useState<string | null>(null);
  // Desempenho da câmera (lib/cameraStats.ts): tentativas, leituras de outro sinal e pulo
  const [run] = useState(() => new CameraRun(sign.id, gloss, 'sign'));

  useEffect(() => {
    if (status === 'active') run.started = true;
  }, [status, run]);

  useEffect(() => {
    if (succeeded) return;
    run.observe(read);
    if (!read) return;
    if (read === gloss) {
      setSucceeded(true);
      saveCameraRun(run.finish('success'));
      Haptics.correctCamera();
      Sfx.correctCamera();
      launchConfetti();
    } else {
      setLastOther(read);
    }
  }, [read, gloss, succeeded, run]);

  useEffect(() => {
    start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showDemo) { demoShownRef.current = true; return; }
    if (demoShownRef.current) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo]);

  useEffect(() => {
    if (showDemo && status === 'active') stop();
  }, [showDemo, status, stop]);

  function openDemo() {
    stop();
    setShowDemo(true);
  }

  function skip() {
    saveCameraRun(run.finish('skip'));
    onComplete(false);
  }

  if (status === 'unavailable') {
    return (
      <div className="exercise-screen">
        <div className="cam-sign-target">
          <div className="cam-sign-prompt">{t('exerciseCameraSign.practiceSign')}</div>
          <div className="cam-sign-letter cam-sign-letter--hand">{gloss}</div>
          <p className="cam-sign-caption">{sign.video_caption}</p>
        </div>
        <div className="cam-sign-unrecognizable">
          <Icon name="sign_language" />
          <p>{t('exerciseCameraMotion.notAvailable', { gloss })}</p>
          <button className="btn btn-primary" onClick={() => onComplete(false)}>
            {t('common.continue')}
          </button>
        </div>
      </div>
    );
  }

  let hint: { text: string; tone: '' | 'tracking' | 'wrong' } | null = null;
  if (!succeeded) {
    if (!bodyPresent) hint = { text: t('exerciseCameraMotion.bodyMissing'), tone: '' };
    else if (!handPresent) hint = { text: t('exerciseCameraMotion.raiseHands'), tone: '' };
    else if (lastOther) hint = { text: t('exerciseCameraMotion.detected', { gesture: lastOther, gloss }), tone: 'wrong' };
    else hint = { text: t('exerciseCameraMotion.watching'), tone: 'tracking' };
  }

  return (
    <div className="exercise-screen cam-sign-layout">
      <div className="cam-sign-target animate__animated animate__fadeInDown animate__faster">
        <div className="cam-sign-prompt">{t('exerciseCameraMotion.makeSign')}</div>
        <div className="cam-sign-letter cam-sign-letter--hand animate__animated animate__bounceIn" style={{ animationDelay: '120ms' }}>{gloss}</div>
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
            aria-label={t('exerciseCameraMotion.correct')}
          >
            <div className="cam-sign-success-card animate__animated animate__bounceIn">
              <TraceCameraArcs className="cam-sign-success-arcs" />
              <Icon name="check" size="40px" className="cam-sign-success-check" />
              <p className="cam-sign-success-title">{t('exerciseCameraMotion.successTitle', { gloss })}</p>
              <button className="btn btn-primary" onClick={() => onComplete(true)} autoFocus>
                {t('exerciseCameraMotion.next')} <Icon name="skip_next" />
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
        </div>

        {status === 'active' && (
          <div className="cam-sign-feedback">
            {hint && (
              <span className={`cam-sign-hint${hint.tone ? ` cam-sign-hint--${hint.tone}` : ''}`}>
                <Icon name={hint.tone === 'wrong' ? 'lightbulb' : 'sign_language'} filled={hint.tone === 'wrong'} /> {hint.text}
              </span>
            )}
            {handPresent && bodyPresent && !succeeded && targetProbability > 0 && (
              <div className="gesture-bar cam-sign-bar">
                <div className="gesture-bar-fill" style={{ width: `${Math.round(targetProbability * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {!succeeded && (
        <button
          className="btn btn-ghost cam-sign-skip"
          onClick={skip}
          aria-label={t('exerciseCameraSign.skipExercise')}
        >
          <Icon name="skip_next" /> {t('common.skip')}
        </button>
      )}
    </div>
  );
}
