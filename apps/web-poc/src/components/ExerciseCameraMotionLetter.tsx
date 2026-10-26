import { useEffect, useRef, useState } from 'react';
import type { Sign } from '../lib/content';
import { useLetterMotionCamera } from '../hooks/useLetterMotionCamera';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { launchConfetti } from '../lib/confetti';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { CameraDemo, hasSignDemo } from './HandDemo';
import { DemoToggle } from './DemoToggle';
import { TraceCameraArcs } from './Brand';
import { CameraRun, saveCameraRun } from '../lib/cameraStats';
import { WrongReadingHint } from '../dicaErro/WrongReadingHint';
import { useWrongReadingHint } from '../dicaErro/gatilho';

interface Props {
  sign: Sign;
  onComplete: (correct: boolean) => void;
}

/**
 * perform_sign de letra com movimento (H, J, K, X, Z e Ç), quando o modelo publicado em
 * /ml/letras-mov/ conhece a letra (src/lib/content.ts decide). Só as mãos pela câmera, avaliadas
 * em janelas de 0,8 a 1,6 s; acerta quando a leitura confirmada (a mesma letra em duas avaliações
 * seguidas) é a letra do exercício. A forma parada da mão, sem o movimento, não conta.
 * As letras paradas continuam no ExerciseCameraSign.
 */
export function ExerciseCameraMotionLetter({ sign, onComplete }: Props) {
  const { t } = useT();
  const letter = sign.gloss;
  const { videoRef, canvasRef, status, handPresent, letter: read, targetProbability, start, stop } =
    useLetterMotionCamera(letter);

  const [succeeded, setSucceeded] = useState(false);
  // Dica sob demanda: o avatar e a detecção disputam a GPU, então a câmera para enquanto ela abre
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const hasDemo = hasSignDemo(sign);
  // Última leitura de outra letra, para a dica "Vimos X" não piscar entre as avaliações
  const [lastOther, setLastOther] = useState<string | null>(null);
  // Desempenho da câmera (lib/cameraStats.ts): tentativas, leituras de outra letra e pulo
  const [run] = useState(() => new CameraRun(sign.id, letter, 'letter'));
  // Dica de erro (src/dicaErro/): a leitura já vem confirmada (duas avaliações seguidas)
  const wrongHint = useWrongReadingHint(letter, read, { confirmed: true, succeeded, enabled: !showDemo });

  useEffect(() => {
    if (status === 'active') run.started = true;
  }, [status, run]);

  useEffect(() => {
    if (succeeded) return;
    run.observe(read);
    if (!read) return;
    if (read === letter) {
      setSucceeded(true);
      saveCameraRun(run.finish('success'));
      Haptics.correctCamera();
      Sfx.correctCamera();
      launchConfetti();
    } else {
      setLastOther(read);
    }
  }, [read, letter, succeeded, run]);

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
          <div className="cam-sign-letter">{letter}</div>
          <p className="cam-sign-caption">{sign.video_caption}</p>
        </div>
        <div className="cam-sign-unrecognizable">
          <Icon name="sign_language" />
          <p>{t('exerciseCameraMotionLetter.notAvailable', { letter })}</p>
          <button className="btn btn-primary" onClick={() => onComplete(false)}>
            {t('common.continue')}
          </button>
        </div>
      </div>
    );
  }

  let hint: { text: string; tone: '' | 'tracking' | 'wrong' } | null = null;
  if (!succeeded) {
    if (!handPresent) hint = { text: t('exerciseCameraMotionLetter.raiseHand'), tone: '' };
    else if (lastOther) hint = { text: t('exerciseCameraMotionLetter.detected', { gesture: lastOther, letter }), tone: 'wrong' };
    else hint = { text: t('exerciseCameraMotionLetter.watching'), tone: 'tracking' };
  }

  return (
    <div className="exercise-screen cam-sign-layout">
      {wrongHint.read && !succeeded ? (
        <WrongReadingHint asked={letter} read={wrongHint.read} kind="letter" onDismiss={wrongHint.dismiss} />
      ) : (
      <div className="cam-sign-target animate__animated animate__fadeInDown animate__faster">
        <div className="cam-sign-prompt">{t('exerciseCameraMotionLetter.makeLetter')}</div>
        <div className="cam-sign-letter animate__animated animate__bounceIn" style={{ animationDelay: '120ms' }}>{letter}</div>
        <p className="cam-sign-caption">{sign.video_caption}</p>
        {hasDemo && !succeeded && (
          <DemoToggle showDemo={showDemo} onOpen={openDemo} onClose={() => setShowDemo(false)} />
        )}
      </div>
      )}

      {showDemo && (
        <div className="cam-sign-demo">
          <CameraDemo sign={sign} />
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
              <TraceCameraArcs className="cam-sign-success-arcs" />
              <Icon name="check" size="40px" className="cam-sign-success-check" />
              <p className="cam-sign-success-title">{t('exerciseCameraSign.successTitle', { letter })}</p>
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
          {!succeeded && (
            <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />
          )}
        </div>

        {status === 'active' && (
          <div className="cam-sign-feedback">
            {hint && (
              <span className={`cam-sign-hint${hint.tone ? ` cam-sign-hint--${hint.tone}` : ''}`}>
                <Icon name={hint.tone === 'wrong' ? 'lightbulb' : 'sign_language'} filled={hint.tone === 'wrong'} /> {hint.text}
              </span>
            )}
            {handPresent && !succeeded && targetProbability > 0 && (
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
