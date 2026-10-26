import { useEffect, useRef, useState } from 'react';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { useRecognizableLetters } from '../recognition/classifier';
import { signsMap } from '../lib/content';
import { SPELL_START, needsRelease, spellStep, type SpellState } from '../lib/fingerspell';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';
import { DemoToggle } from './DemoToggle';
import { CameraDemo, hasSignDemo } from './HandDemo';
import { ExerciseOrderSequence } from './ExerciseOrderSequence';
import { CameraRun, saveCameraRun } from '../lib/cameraStats';

interface Props {
  word: string;
  letters: string[];
  /** Confiança mínima por letra (null = padrão do reconhecedor, spec-03 5.3). */
  perLetterConfidence?: number | null;
  /** "Soletre seu nome": a palavra é o nome do perfil (muda o enunciado). */
  ownName?: boolean;
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

/**
 * Soletração com a câmera (spec-03 11.8 e 5.4): uma letra por vez, com o progresso na faixa de
 * letras. Errar uma letra não reinicia a palavra: a letra da vez continua esperando.
 * Se o classificador em uso não avalia alguma letra da palavra, vira order_sequence.
 */
export function ExerciseFingerspell({ word, letters, perLetterConfidence = null, ownName = false, onAnswer, onNext }: Props) {
  const recognizable = useRecognizableLetters();
  const evaluable = letters.every(l => recognizable.has(l));

  if (!evaluable) {
    return <FingerspellOrder word={word} letters={letters} ownName={ownName} onAnswer={onAnswer} onNext={onNext} />;
  }
  return (
    <FingerspellCamera
      word={word}
      letters={letters}
      perLetterConfidence={perLetterConfidence}
      ownName={ownName}
      onAnswer={onAnswer}
      onNext={onNext}
    />
  );
}

function FingerspellOrder({ word, letters, ownName, onAnswer, onNext }: Omit<Props, 'perLetterConfidence'>) {
  const { t } = useT();
  return (
    <ExerciseOrderSequence
      steps={letters}
      correctOrder={letters.map((_, i) => i)}
      prompt={t(ownName ? 'exerciseOrderSequence.spellOwnNamePrompt' : 'exerciseOrderSequence.spellPrompt', { word })}
      onAnswer={onAnswer}
      onNext={onNext}
    />
  );
}

function FingerspellCamera({ word, letters, perLetterConfidence = null, ownName, onAnswer, onNext }: Props) {
  const { t } = useT();
  const { videoRef, canvasRef, status, stableGesture, handPresent, confidence, start, stop } = useCameraRecognizer();
  const [spell, setSpell] = useState<SpellState>(SPELL_START);
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const answeredRef = useRef(false);
  // Desempenho da câmera (lib/cameraStats.ts): cada letra da palavra é uma vez da letra
  const cameraStartedRef = useRef(false);
  const runRef = useRef<CameraRun>(new CameraRun(`letra-${letters[0]}`, letters[0], 'letter'));

  const done = spell.index >= letters.length;
  const current = letters[Math.min(spell.index, letters.length - 1)];
  const currentSign = signsMap[`letra-${current}`];
  const hasDemo = currentSign ? hasSignDemo(currentSign) : false;
  const waitRelease = needsRelease(letters, spell);

  useEffect(() => {
    start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'active') return;
    cameraStartedRef.current = true;
    runRef.current.started = true;
  }, [status]);

  // Cada leitura estável passa pela regra da soletração (src/lib/fingerspell.ts)
  useEffect(() => {
    if (showDemo) return;
    // A letra anterior da palavra (ainda na mão ou repetida na troca de forma) não é leitura errada
    runRef.current.observe(stableGesture, spell.index > 0 ? letters[spell.index - 1] : null);
    const next = spellStep(letters, spell, stableGesture, confidence, perLetterConfidence);
    if (next === spell) return;
    if (next.index > spell.index) {
      Haptics.correctCamera();
      Sfx.correct();
      saveCameraRun(runRef.current.finish('success'));
      if (next.index < letters.length) {
        const letter = letters[next.index];
        const run = new CameraRun(`letra-${letter}`, letter, 'letter', stableGesture);
        run.started = cameraStartedRef.current;
        runRef.current = run;
      }
    }
    setSpell(next);
  }, [spell, stableGesture, confidence, perLetterConfidence, letters, showDemo]);

  useEffect(() => {
    if (!done || answeredRef.current) return;
    answeredRef.current = true;
    stop();
    onAnswer(true);
  }, [done, stop, onAnswer]);

  useEffect(() => {
    if (showDemo) { demoShownRef.current = true; return; }
    // Demonstração fechada: a câmera volta
    if (demoShownRef.current) start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDemo]);

  // A câmera terminou de iniciar com a demonstração aberta: para de novo (os dois disputam a GPU)
  useEffect(() => {
    if (showDemo && status === 'active') stop();
  }, [showDemo, status, stop]);

  function skip() {
    if (answeredRef.current) return;
    answeredRef.current = true;
    // Só a letra da vez conta o pulo: as seguintes nem chegaram à câmera
    saveCameraRun(runRef.current.finish('skip'));
    stop();
    onAnswer(false);
    onNext();
  }

  let hint: { icon: 'sign_language' | 'lightbulb' | 'replay'; text: string; tone?: string } | null = null;
  if (status === 'active' && !done) {
    if (!handPresent) hint = { icon: 'sign_language', text: t('exerciseFingerspell.positionHand') };
    else if (waitRelease) hint = { icon: 'replay', text: t('exerciseFingerspell.releaseRepeat', { letter: current }), tone: 'wrong' };
    else if (stableGesture && stableGesture !== current) hint = { icon: 'lightbulb', text: t('exerciseFingerspell.detected', { gesture: stableGesture, letter: current }), tone: 'wrong' };
    else hint = { icon: 'sign_language', text: t('exerciseFingerspell.makeLetter', { letter: current }), tone: 'tracking' };
  }

  return (
    <div className="exercise-screen cam-sign-layout">
      <div className="cam-sign-target">
        <h2 className="exercise-prompt">{t(ownName ? 'exerciseFingerspell.spellOwnName' : 'exerciseFingerspell.spellWord', { word })}</h2>

        <ol className="fingerspell-strip" aria-label={t('exerciseFingerspell.progress', { done: spell.index, total: letters.length })}>
          {letters.map((l, i) => {
            const isDone = i < spell.index;
            const isCurrent = i === spell.index && !done;
            return (
              <li
                key={i}
                className={`fingerspell-cell${isCurrent ? ' fingerspell-cell--current' : ''}${isDone ? ' fingerspell-cell--done' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="fingerspell-cell-letter">{l}</span>
                {isDone && <Icon name="check" className="fingerspell-cell-check" label={t('exerciseFingerspell.letterDone', { letter: l })} />}
              </li>
            );
          })}
        </ol>

        <p className="fingerspell-progress tabular" aria-live="polite">
          {done
            ? t('exerciseFingerspell.wordComplete')
            : t('exerciseFingerspell.currentLetterCount', { letter: current, n: spell.index + 1, total: letters.length })}
        </p>
        {currentSign && !done && <p className="cam-sign-caption">{currentSign.video_caption}</p>}
        {hasDemo && !done && (
          <DemoToggle showDemo={showDemo} onOpen={() => { stop(); setShowDemo(true); }} onClose={() => setShowDemo(false)} />
        )}
      </div>

      {showDemo && currentSign && (
        <div className="cam-sign-demo">
          <CameraDemo sign={currentSign} />
          <p className="cam-sign-demo-note">{t('signDemo.cameraPaused')}</p>
        </div>
      )}

      <div className={`cam-sign-viewport-wrap${showDemo ? ' hidden' : ''}`}>
        {(status === 'idle' || status === 'loading') && !done && (
          <div className="cam-sign-placeholder">
            <Icon name={status === 'loading' ? 'progress_activity' : 'videocam'} spin={status === 'loading'} />
            <p>{status === 'loading' ? t('common.loading') : t('exerciseFingerspell.starting')}</p>
          </div>
        )}
        {(status === 'denied' || status === 'error') && !done && (
          <div className="cam-sign-placeholder cam-sign-placeholder--error">
            <Icon name="videocam_off" />
            <p>{t('exerciseFingerspell.cameraUnavailable')}</p>
            <button className="btn btn-secondary btn-sm" onClick={start}>{t('exerciseFingerspell.retry')}</button>
          </div>
        )}
        <div className={`cam-sign-viewport${status === 'active' && !done ? '' : ' hidden'}`}>
          <video ref={videoRef} className="camera-video" playsInline muted aria-label={t('exerciseFingerspell.cameraFeed')} />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
          <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />
        </div>
        {hint && (
          <div className="cam-sign-feedback">
            <span className={`cam-sign-hint${hint.tone ? ` cam-sign-hint--${hint.tone}` : ''}`} role="status">
              <Icon name={hint.icon} /> {hint.text}
            </span>
            {handPresent && confidence > 0 && (
              <div className="gesture-bar cam-sign-bar">
                <div className="gesture-bar-fill" style={{ width: `${Math.round(confidence * 100)}%` }} />
              </div>
            )}
          </div>
        )}
      </div>

      {!done && (
        <button className="btn btn-ghost cam-sign-skip" onClick={skip} aria-label={t('exerciseFingerspell.skipExercise')}>
          <Icon name="skip_next" /> {t('common.skip')}
        </button>
      )}

      {done && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseFingerspell.complete')}
          body={<span className="feedback-gloss">{word}</span>}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
