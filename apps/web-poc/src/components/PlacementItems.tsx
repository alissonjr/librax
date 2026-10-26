import { Component, lazy, Suspense, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Sign } from '../lib/content';
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { useLetterMotionCamera } from '../hooks/useLetterMotionCamera';
import { CameraRun, saveCameraRun } from '../lib/cameraStats';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { ITEM_TIME_MS, type PlacementAnswer } from '../lib/placement';
import { hasHand3d, maskHandGloss, webglAvailable } from '../mao3d/disponivel';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { SignDemo } from './SignDemo';
import { TraceCameraArcs } from './Brand';
import '../styles/mao3d.css';

/**
 * Itens do teste de nivelamento (lib/placement.ts). Diferente dos exercícios da lição, aqui nada
 * ensina: sem "Ver o movimento", sem descrição da mão e sem a resposta no erro. Cada item tem um
 * tempo curto (contado com a câmera já ligada) e um "Não sei" sempre à vista; quando o tempo acaba,
 * a pessoa escolhe entre mais tempo e a próxima (nada avança sozinho sem um botão visível).
 */

/** Depois do acerto pela câmera, a próxima entra sozinha neste tempo (o botão fica à vista). */
const SUCCESS_ADVANCE_MS = 1200;

/** Contagem regressiva que só anda com `running`. `extend` recomeça do tempo cheio. */
export function useCountdown(limitMs: number, running: boolean) {
  const [left, setLeft] = useState(limitMs);
  useEffect(() => {
    if (!running || left <= 0) return;
    const step = Math.min(1000, left);
    const timer = window.setTimeout(() => setLeft(l => Math.max(0, l - step)), step);
    return () => window.clearTimeout(timer);
  }, [running, left]);
  return { left, expired: left <= 0, extend: () => setLeft(limitMs) };
}

function TimerPill({ left, stage = false }: { left: number; stage?: boolean }) {
  const { t } = useT();
  const seconds = Math.ceil(left / 1000);
  return (
    <span
      className={`placement-timer${stage ? ' placement-timer--stage' : ''}${seconds <= 5 ? ' placement-timer--low' : ''}`}
      role="timer"
      aria-label={t('placement.timeLeftAria', { seconds })}
    >
      <Icon name="timer" /> <span className="tabular" aria-hidden="true">{t('placement.timeLeft', { seconds })}</span>
    </span>
  );
}

function TimeUpPanel({ onMore, onNext, stage = false }: { onMore: () => void; onNext: () => void; stage?: boolean }) {
  const { t } = useT();
  return (
    <div className={`placement-timeup${stage ? ' placement-timeup--stage' : ''}`} role="alert">
      <p className="placement-timeup-title"><Icon name="schedule" /> {t('placement.timeUpTitle')}</p>
      <p className="placement-timeup-text">{t('placement.timeUpText')}</p>
      <div className="placement-timeup-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onMore}>{t('placement.moreTime')}</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onNext}>{t('placement.next')}</button>
      </div>
    </div>
  );
}

export type CameraLoss = 'denied' | 'model';

interface CameraItemProps {
  sign: Sign;
  onAnswer: (answer: PlacementAnswer) => void;
  /** A câmera não ficou disponível: 'denied' para o teste todo, 'model' só para este sinal. */
  onCameraLost: (reason: CameraLoss) => void;
}

interface StageProps {
  sign: Sign;
  prompt: string;
  status: string;
  handPresent: boolean;
  hint: string | null;
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  succeeded: boolean;
  limitMs: number;
  onNext: () => void;
  onSkip: () => void;
}

/** Palco comum dos itens com câmera: alvo, vídeo com o esqueleto, tempo, acerto e "Não sei". */
function CameraStage({ sign, prompt, status, handPresent, hint, videoRef, canvasRef, succeeded, limitMs, onNext, onSkip }: StageProps) {
  const { t } = useT();
  const { left, expired, extend } = useCountdown(limitMs, status === 'active' && !succeeded);

  // Acerto: a próxima entra sozinha, com o botão à vista
  useEffect(() => {
    if (!succeeded) return;
    const timer = window.setTimeout(onNext, SUCCESS_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [succeeded, onNext]);

  return (
    <div className="exercise-screen cam-sign-layout placement-item">
      <div className="placement-target">
        <div>
          <div className="cam-sign-prompt">{prompt}</div>
          <div className="cam-sign-letter">{sign.gloss}</div>
        </div>
        {status === 'active' && !succeeded && <TimerPill left={left} stage />}
      </div>

      <div className="cam-sign-viewport-wrap">
        {succeeded && (
          <div className="cam-sign-success-overlay" role="status">
            <div className="cam-sign-success-card">
              <TraceCameraArcs className="cam-sign-success-arcs" />
              <Icon name="check" size="40px" className="cam-sign-success-check" />
              <p className="cam-sign-success-title">{t('placement.correct')}</p>
              <button className="btn btn-primary" onClick={onNext} autoFocus>
                {t('placement.next')} <Icon name="skip_next" />
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

        <div className={`cam-sign-viewport${status === 'active' ? '' : ' hidden'}`}>
          <video ref={videoRef} className="camera-video" playsInline muted aria-label={t('exerciseCameraSign.cameraFeed')} />
          <canvas ref={canvasRef} className="camera-canvas" aria-hidden="true" />
          {!succeeded && <div className={`cam-guide${handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />}
        </div>

        {status === 'active' && !succeeded && hint && (
          <div className="cam-sign-feedback">
            <span className="cam-sign-hint"><Icon name="sign_language" /> {hint}</span>
          </div>
        )}

        {expired && !succeeded && <TimeUpPanel stage onMore={extend} onNext={onSkip} />}
      </div>

      {!succeeded && (
        <button className="btn btn-ghost cam-sign-skip" onClick={onSkip}>
          <Icon name="skip_next" /> {t('placement.dontKnow')}
        </button>
      )}
    </div>
  );
}

/** Letra parada ou número de 0 a 9: o classificador das letras ou o modelo dos números. */
export function PlacementCameraItem({ sign, onAnswer, onCameraLost }: CameraItemProps) {
  const { t } = useT();
  const isNumber = sign.category === 'numeros';
  const cam = useCameraRecognizer({ classifier: isNumber ? 'numeros' : 'letras' });
  const [succeeded, setSucceeded] = useState(false);
  const [run] = useState(() => new CameraRun(sign.id, sign.gloss, isNumber ? 'number' : 'letter'));
  const answered = useRef(false);

  useEffect(() => {
    cam.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cam.status === 'active') run.started = true;
    // Sem permissão: o teste segue sem câmera. Erro nos números costuma ser o modelo: só este item.
    if (cam.status === 'denied') onCameraLost('denied');
    if (cam.status === 'error') onCameraLost(isNumber ? 'model' : 'denied');
  }, [cam.status, run, onCameraLost, isNumber]);

  useEffect(() => {
    if (succeeded) return;
    run.observe(cam.stableGesture);
    if (cam.stableGesture === sign.gloss) {
      setSucceeded(true);
      saveCameraRun(run.finish('success'));
      Haptics.correctCamera();
      Sfx.correctCamera();
    }
  }, [cam.stableGesture, sign.gloss, succeeded, run]);

  const answer = (correct: boolean) => {
    if (answered.current) return;
    answered.current = true;
    if (!correct) saveCameraRun(run.finish('skip'));
    onAnswer({ correct, via: 'camera' });
  };

  let hint: string | null = null;
  if (!cam.handPresent) hint = t('exerciseCameraSign.positionHand');
  else if (cam.stableGesture && cam.stableGesture !== sign.gloss) hint = t('placement.seen', { gesture: cam.stableGesture });
  else hint = t('exerciseCameraSign.handDetected');

  return (
    <CameraStage
      sign={sign}
      prompt={t(isNumber ? 'placement.makeNumber' : 'placement.makeLetter')}
      status={cam.status}
      handPresent={cam.handPresent}
      hint={hint}
      videoRef={cam.videoRef}
      canvasRef={cam.canvasRef}
      succeeded={succeeded}
      limitMs={ITEM_TIME_MS[isNumber ? 'camera-number' : 'camera-letter']}
      onNext={() => answer(true)}
      onSkip={() => answer(false)}
    />
  );
}

/** Letra com movimento (H, J, K, X, Ç): o modelo das letras com movimento, com a mesma regra de leitura da lição. */
export function PlacementMotionItem({ sign, onAnswer, onCameraLost }: CameraItemProps) {
  const { t } = useT();
  const cam = useLetterMotionCamera(sign.gloss);
  const [succeeded, setSucceeded] = useState(false);
  const [lastOther, setLastOther] = useState<string | null>(null);
  const [run] = useState(() => new CameraRun(sign.id, sign.gloss, 'letter'));
  const answered = useRef(false);

  useEffect(() => {
    cam.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cam.status === 'active') run.started = true;
    if (cam.status === 'unavailable') onCameraLost('model');
    if (cam.status === 'denied' || cam.status === 'error') onCameraLost('denied');
  }, [cam.status, run, onCameraLost]);

  useEffect(() => {
    if (succeeded) return;
    run.observe(cam.letter);
    if (!cam.letter) return;
    if (cam.letter === sign.gloss) {
      setSucceeded(true);
      saveCameraRun(run.finish('success'));
      Haptics.correctCamera();
      Sfx.correctCamera();
    } else {
      setLastOther(cam.letter);
    }
  }, [cam.letter, sign.gloss, succeeded, run]);

  const answer = (correct: boolean) => {
    if (answered.current) return;
    answered.current = true;
    if (!correct) saveCameraRun(run.finish('skip'));
    onAnswer({ correct, via: 'camera' });
  };

  let hint: string;
  if (!cam.handPresent) hint = t('exerciseCameraMotionLetter.raiseHand');
  else if (lastOther) hint = t('placement.seen', { gesture: lastOther });
  else hint = t('exerciseCameraMotionLetter.watching');

  return (
    <CameraStage
      sign={sign}
      prompt={t('placement.makeLetter')}
      status={cam.status}
      handPresent={cam.handPresent}
      hint={hint}
      videoRef={cam.videoRef}
      canvasRef={cam.canvasRef}
      succeeded={succeeded}
      limitMs={ITEM_TIME_MS['camera-motion']}
      onNext={() => answer(true)}
      onSkip={() => answer(false)}
    />
  );
}

/* ---------- "Qual letra é esta?" com a mão em 3D ---------- */

const Mao3DView = lazy(() => import('../mao3d/Mao3DView'));

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** A forma da mão sem dizer qual é: a mão em 3D; sem 3D, o avatar ou a descrição sem a letra. */
function HandStage({ sign }: { sign: Sign }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const text = <p className="wcv-stage-text">{maskHandGloss(sign.params.CM, sign.gloss)}</p>;
  if (failed || !hasHand3d(sign) || !webglAvailable()) {
    return <SignDemo sign={sign} conceal className="sign-demo--choose" fallback={text} />;
  }
  return (
    <Boundary onError={() => setFailed(true)}>
      <Suspense fallback={<div className="placement-hand-loading"><Icon name="progress_activity" spin /> {t('mao3d.loading')}</div>}>
        <Mao3DView sign={sign} compact conceal className="placement-hand" onError={() => setFailed(true)} />
      </Suspense>
    </Boundary>
  );
}

interface ChoiceItemProps {
  sign: Sign;
  /** As 4 opções, já sorteadas (lib/placement.ts drawPlacementOptions). */
  options: { id: string; gloss: string }[];
  onAnswer: (answer: PlacementAnswer) => void;
}

export function PlacementChoiceItem({ sign, options, onAnswer }: ChoiceItemProps) {
  const { t } = useT();
  const [selected, setSelected] = useState<string | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
  const answered = useRef(false);
  const { left, expired, extend } = useCountdown(ITEM_TIME_MS.choice, true);
  const isNumber = sign.category === 'numeros';

  const answer = (correct: boolean) => {
    if (answered.current) return;
    answered.current = true;
    onAnswer({ correct, via: 'choice' });
  };

  function handleKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const j = (i + step + options.length) % options.length;
    setSelected(options[j].id);
    radios.current[j]?.focus();
  }

  const selectedIdx = options.findIndex(o => o.id === selected);
  const focusIdx = selectedIdx >= 0 ? selectedIdx : 0;

  return (
    <div className="exercise-screen placement-item">
      <div className="placement-target placement-target--choice">
        <h2 className="exercise-prompt" id="placement-choice-prompt">
          {t(isNumber ? 'placement.whichNumber' : 'placement.whichLetter')}
        </h2>
        <TimerPill left={left} />
      </div>

      <div className="wcv-stage placement-hand-stage">
        <HandStage sign={sign} />
      </div>

      {expired && <TimeUpPanel onMore={extend} onNext={() => answer(false)} />}

      <div className="placement-options" role="radiogroup" aria-labelledby="placement-choice-prompt">
        {options.map((option, i) => {
          const isSelected = selected === option.id;
          return (
            <button
              key={option.id}
              ref={el => { radios.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              tabIndex={i === focusIdx ? 0 : -1}
              className={`placement-option${isSelected ? ' placement-option--selected' : ''}`}
              onClick={() => setSelected(option.id)}
              onKeyDown={e => handleKey(e, i)}
            >
              {option.gloss}
            </button>
          );
        })}
      </div>

      <div className="wcv-check-bar placement-choice-bar">
        <button type="button" className="btn btn-ghost" onClick={() => answer(false)}>
          {t('placement.dontKnow')}
        </button>
        <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => answer(selected === sign.id)}>
          {t('placement.confirm')}
        </button>
      </div>
    </div>
  );
}
