import { useEffect, useRef, useState } from 'react';
import { useSpellCamera } from '../hooks/useSpellCamera';
import { useRecognizableLetters } from '../recognition/classifier';
import { signsMap } from '../lib/content';
import {
  SPELL_START, confirmFreeStep, currentReader, needsRelease, spellAdvance, spellGesture,
  type SpellReader, type SpellState,
} from '../lib/fingerspell';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';
import { DemoToggle } from './DemoToggle';
import { CameraDemo, hasSignDemo } from './HandDemo';
import { ExerciseOrderSequence } from './ExerciseOrderSequence';
import { CameraRun, saveCameraRun } from '../lib/cameraStats';
import '../styles/spell.css';

interface Props {
  word: string;
  letters: string[];
  /** Quem lê cada letra (resolveExercises); sem a lista, todas com o classificador das letras paradas. */
  readers?: SpellReader[];
  /** Número feito dígito a dígito ("faça 20"): `letters` são os dígitos. */
  numbers?: boolean;
  /** Confiança mínima por letra (null = padrão do reconhecedor, spec-03 5.3). */
  perLetterConfidence?: number | null;
  /** "Soletre seu nome": a palavra é o nome do perfil (muda o enunciado). */
  ownName?: boolean;
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

/**
 * Soletração com a câmera (spec-03 11.8 e 5.4): uma letra por vez, com o progresso na faixa de
 * letras. Errar uma letra não reinicia a palavra: a letra da vez continua esperando. Cada letra tem
 * o seu leitor (letras paradas, letras com movimento ou números) e a letra sem câmera é prática
 * livre: a pessoa faz e toca em "Fiz". Se o classificador em uso deixa de avaliar alguma letra
 * parada da palavra, vira order_sequence.
 */
export function ExerciseFingerspell({ word, letters, readers, numbers = false, perLetterConfidence = null, ownName = false, onAnswer, onNext }: Props) {
  const recognizable = useRecognizableLetters();
  const stepReaders = readers ?? letters.map((): SpellReader => 'letras');
  const evaluable = letters.every((l, i) => stepReaders[i] !== 'letras' || recognizable.has(l));

  if (!evaluable) {
    return <FingerspellOrder word={word} letters={letters} numbers={numbers} ownName={ownName} onAnswer={onAnswer} onNext={onNext} />;
  }
  return (
    <FingerspellCamera
      word={word}
      letters={letters}
      readers={stepReaders}
      numbers={numbers}
      perLetterConfidence={perLetterConfidence}
      ownName={ownName}
      onAnswer={onAnswer}
      onNext={onNext}
    />
  );
}

function FingerspellOrder({ word, letters, numbers, ownName, onAnswer, onNext }: Omit<Props, 'perLetterConfidence' | 'readers'>) {
  const { t } = useT();
  const prompt = numbers ? 'exerciseOrderSequence.spellNumberPrompt'
    : ownName ? 'exerciseOrderSequence.spellOwnNamePrompt' : 'exerciseOrderSequence.spellPrompt';
  return (
    <ExerciseOrderSequence
      steps={letters}
      correctOrder={letters.map((_, i) => i)}
      prompt={t(prompt, { word })}
      onAnswer={onAnswer}
      onNext={onNext}
    />
  );
}

function FingerspellCamera({ word, letters, readers = [], numbers = false, perLetterConfidence = null, ownName, onAnswer, onNext }: Props) {
  const { t } = useT();
  const [spell, setSpell] = useState<SpellState>(SPELL_START);
  const { videoRef, canvasRef, status, stableGesture, motionLetter, handPresent, confidence, start, stop } = useSpellCamera(letters, readers, spell.index);
  const [showDemo, setShowDemo] = useState(false);
  const demoShownRef = useRef(false);
  const answeredRef = useRef(false);
  const signPrefix = numbers ? 'numero' : 'letra';
  const runKind = numbers ? 'number' : 'letter';
  // Desempenho da câmera (lib/cameraStats.ts): cada letra avaliada da palavra é uma vez da letra
  const cameraStartedRef = useRef(false);
  const newRun = (index: number, initial: string | null = null) => {
    const run = new CameraRun(`${signPrefix}-${letters[index]}`, letters[index], runKind, initial);
    run.started = cameraStartedRef.current;
    return run;
  };
  const runRef = useRef<CameraRun | null>(readers[0] === 'livre' ? null : newRun(0));

  const done = spell.index >= letters.length;
  const current = letters[Math.min(spell.index, letters.length - 1)];
  const reader = currentReader(readers, spell, letters.length);
  const free = reader === 'livre';
  const currentSign = signsMap[`${signPrefix}-${current}`];
  const hasDemo = currentSign ? hasSignDemo(currentSign) : false;
  const waitRelease = needsRelease(letters, spell);
  // A letra que acabou de ser aceita ainda na mão não é leitura errada (a pessoa está trocando de forma)
  const previous = spell.index > 0 ? letters[spell.index - 1] : null;
  const readings = { still: stableGesture, motion: motionLetter };
  const gesture = spellGesture(readers, spell, letters.length, readings);

  useEffect(() => {
    start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== 'active') return;
    cameraStartedRef.current = true;
    if (runRef.current) runRef.current.started = true;
  }, [status]);

  /** Fecha a vez da letra e abre a da próxima (sem vez nas letras livres, que não têm nota). */
  function moveTo(next: SpellState, initial: string | null) {
    if (next.index < letters.length && readers[next.index] !== 'livre') runRef.current = newRun(next.index, initial);
    else runRef.current = null;
    setSpell(next);
  }

  // Cada leitura estável passa pela regra da soletração (src/lib/fingerspell.ts)
  useEffect(() => {
    if (showDemo || free) return;
    // A letra anterior da palavra (ainda na mão ou repetida na troca de forma) não é leitura errada
    runRef.current?.observe(gesture, spell.index > 0 ? letters[spell.index - 1] : null);
    const next = spellAdvance(letters, readers, spell, readings, confidence, perLetterConfidence);
    if (next === spell) return;
    if (next.index > spell.index) {
      Haptics.correctCamera();
      Sfx.correct();
      const finished = runRef.current?.finish('success');
      if (finished) saveCameraRun(finished);
      moveTo(next, gesture);
      return;
    }
    setSpell(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spell, stableGesture, motionLetter, confidence, perLetterConfidence, letters, readers, showDemo, free]);

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

  function confirmFree() {
    const next = confirmFreeStep(letters, readers, spell);
    if (next === spell) return;
    setShowDemo(false);
    moveTo(next, null);
  }

  function skip() {
    if (answeredRef.current) return;
    answeredRef.current = true;
    // Só a letra da vez conta o pulo: as seguintes nem chegaram à câmera
    const finished = runRef.current?.finish('skip');
    if (finished) saveCameraRun(finished);
    stop();
    onAnswer(false);
    onNext();
  }

  const key = numbers ? 'Digit' : 'Letter';
  let hint: { icon: 'sign_language' | 'lightbulb' | 'replay' | 'info'; text: string; tone?: string } | null = null;
  if (status === 'active' && !done) {
    if (free) hint = { icon: 'info', text: t('exerciseFingerspell.freeStep', { letter: current }), tone: 'tracking' };
    else if (!handPresent) hint = { icon: 'sign_language', text: t('exerciseFingerspell.positionHand') };
    else if (waitRelease) hint = { icon: 'replay', text: t('exerciseFingerspell.releaseRepeat', { letter: current }), tone: 'wrong' };
    else if (gesture && gesture !== current && gesture !== previous) hint = { icon: 'lightbulb', text: t(`exerciseFingerspell.detected${numbers ? 'Digit' : ''}`, { gesture, letter: current }), tone: 'wrong' };
    else if (reader === 'letras-mov') hint = { icon: 'sign_language', text: t('exerciseFingerspell.makeMotionLetter', { letter: current }), tone: 'tracking' };
    else hint = { icon: 'sign_language', text: t(`exerciseFingerspell.make${key}`, { letter: current }), tone: 'tracking' };
  }

  const prompt = numbers ? 'exerciseFingerspell.spellNumber'
    : ownName ? 'exerciseFingerspell.spellOwnName' : 'exerciseFingerspell.spellWord';

  return (
    <div className="exercise-screen cam-sign-layout">
      <div className="cam-sign-target">
        <h2 className="exercise-prompt">{t(prompt, { word })}</h2>

        <ol
          className="fingerspell-strip"
          aria-label={t(numbers ? 'exerciseFingerspell.progressDigits' : 'exerciseFingerspell.progress', { done: spell.index, total: letters.length })}
        >
          {letters.map((l, i) => {
            const isDone = i < spell.index;
            const isCurrent = i === spell.index && !done;
            const isFree = readers[i] === 'livre';
            return (
              <li
                key={i}
                className={`fingerspell-cell${isCurrent ? ' fingerspell-cell--current' : ''}${isDone ? ' fingerspell-cell--done' : ''}${isFree ? ' fingerspell-cell--free' : ''}`}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="fingerspell-cell-letter">{l}</span>
                {isFree && !isDone && <span className="sr-only">{t('exerciseFingerspell.freeCell')}</span>}
                {isDone && <Icon name="check" className="fingerspell-cell-check" label={t(`exerciseFingerspell.${numbers ? 'digit' : 'letter'}Done`, { letter: l })} />}
              </li>
            );
          })}
        </ol>

        <p className="fingerspell-progress tabular" aria-live="polite">
          {done
            ? t(numbers ? 'exerciseFingerspell.numberComplete' : 'exerciseFingerspell.wordComplete')
            : t(`exerciseFingerspell.current${key}Count`, { letter: current, n: spell.index + 1, total: letters.length })}
        </p>
        {currentSign && !done && <p className="cam-sign-caption">{currentSign.video_caption}</p>}
        {free && !done && (
          <button type="button" className="btn btn-primary btn-sm btn-inline fingerspell-free-done" onClick={confirmFree}>
            <Icon name="check" /> {t('exerciseFingerspell.freeDone', { letter: current })}
          </button>
        )}
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
            {!free && handPresent && confidence > 0 && (
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
          title={t(numbers ? 'exerciseFingerspell.numberDone' : 'exerciseFingerspell.complete')}
          body={<span className="feedback-gloss">{word}</span>}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
