import { useEffect, useState } from 'react';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { useRecognizableLetters } from '../recognition/classifier';
import { useT } from '../i18n';
import { Icon } from './Icon';

interface Props {
  word: string;
  letters: string[];
  onComplete: (correct: boolean) => void;
}

export function ExerciseFingerspell({ word, letters, onComplete }: Props) {
  const { t } = useT();
  const { videoRef, canvasRef, status, stableGesture, confidence, start } = useCameraRecognizer();
  const [confirmed, setConfirmed] = useState<boolean[]>(() => letters.map(() => false));
  const [current, setCurrent] = useState(0);
  const [lastGesture, setLastGesture] = useState<string | null>(null);

  const recognizable = useRecognizableLetters();
  const isRecognizable = letters.every(l => recognizable.has(l));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (isRecognizable) start(); }, [isRecognizable]);

  useEffect(() => {
    if (!stableGesture || stableGesture === lastGesture) return;
    setLastGesture(stableGesture);
    if (stableGesture === letters[current]) {
      const next = [...confirmed];
      next[current] = true;
      setConfirmed(next);
      if (current + 1 < letters.length) {
        setCurrent(current + 1);
      } else {
        setTimeout(() => onComplete(true), 800);
      }
    }
  }, [stableGesture]);

  if (!isRecognizable) {
    return (
      <div className="exercise-screen">
        <h2 className="exercise-prompt">{t('exerciseFingerspell.spell')} <strong>{word}</strong></h2>
        <div className="fingerspell-letters">
          {letters.map((l, i) => (
            <div key={i} className="fingerspell-cell">{l}</div>
          ))}
        </div>
        <p className="fingerspell-note">
          {t('exerciseFingerspell.manualNote', { word })}
        </p>
        <button className="btn btn-primary" onClick={() => onComplete(false)}>
          <Icon name="arrow_forward" /> {t('common.continue')}
        </button>
      </div>
    );
  }

  const done = confirmed.every(Boolean);

  return (
    <div className="exercise-screen cam-sign-layout">
      <div className="cam-sign-target">
        <h2 className="exercise-prompt">{t('exerciseFingerspell.spellTitle')}</h2>
        <div className="fingerspell-word">{word}</div>

        <div className="fingerspell-strip">
          {letters.map((l, i) => (
            <div
              key={i}
              className={`fingerspell-cell${i === current && !done ? ' fingerspell-cell--current animate__animated animate__pulse animate__infinite' : ''}${confirmed[i] ? ' fingerspell-cell--done animate__animated animate__bounceIn' : ''}`}
            >
              {confirmed[i] ? <Icon name="check" /> : l}
            </div>
          ))}
        </div>

        <p className="cam-sign-caption">
          {done ? t('exerciseFingerspell.wordComplete') : t('exerciseFingerspell.currentLetter', { letter: letters[current] })}
        </p>
      </div>

      <div className="cam-sign-viewport-wrap">
        {done && (
          <div className="cam-sign-success-overlay animate__animated animate__bounceIn" aria-label={t('exerciseFingerspell.complete')}>
            <Icon name="check" className="animate__animated animate__tada animate__delay-1s" />
          </div>
        )}
        {(status === 'idle' || status === 'loading') && (
          <div className="cam-sign-placeholder">
            <Icon name={status === 'loading' ? 'progress_activity' : 'videocam'} spin={status === 'loading'} />
            <p>{status === 'loading' ? t('common.loading') : t('exerciseFingerspell.starting')}</p>
          </div>
        )}
        {(status === 'denied' || status === 'error') && (
          <div className="cam-sign-placeholder cam-sign-placeholder--error">
            <Icon name="videocam_off" />
            <p>{t('exerciseFingerspell.cameraUnavailable')}</p>
            <button className="btn btn-secondary btn-sm" onClick={start}>{t('exerciseFingerspell.retry')}</button>
          </div>
        )}
        <div className={`cam-sign-viewport${status === 'active' ? '' : ' hidden'}`}>
          <video ref={videoRef} className="camera-video" playsInline muted aria-label={t('exerciseFingerspell.cameraFeed')} />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
        </div>
        <div className="cam-sign-feedback">
          {status === 'active' && confidence > 0 && (
            <div className="gesture-bar cam-sign-bar">
              <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
            </div>
          )}
        </div>
      </div>

      <button className="btn btn-ghost cam-sign-skip" onClick={() => onComplete(false)}>
        {t('common.skip')}
      </button>
    </div>
  );
}
