import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { maskChoiceCaption, type CameraRecognizer, type ContrastPair, type Sign } from '../lib/content';
import { useT, type TFunc } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { Icon } from './Icon';
import { TraceArrowIcon } from './Brand';
import { FeedbackPanel } from './FeedbackPanel';
import { ExerciseCameraSign } from './ExerciseCameraSign';
import { ExerciseCameraMotionLetter } from './ExerciseCameraMotionLetter';
import { ExerciseCameraMotionSign } from './ExerciseCameraMotionSign';
import { hasHand3d, isMovingLetter, prefersReducedMotion, webglAvailable } from '../mao3d/disponivel';
import '../styles/mao3d.css';
import '../styles/contrast.css';

const Mao3DMini = lazy(() => import('../mao3d/Mao3DMini'));

/** Resultado do exercício: certo quando acertou a checagem e fez os dois na câmera (quando houve câmera). */
export interface ContrastPairResult {
  correct: boolean;
  /** Sinais que a pessoa errou na checagem ou pulou na câmera (revisam mais cedo no SRS). */
  missed: string[];
}

/**
 * A câmera dá para usar? Sem getUserMedia (navegador sem câmera, página sem HTTPS) ou com a
 * permissão negada, a etapa da câmera é pulada sem contar erro.
 */
export async function cameraUsable(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const status = await navigator.permissions?.query({ name: 'camera' as PermissionName });
    if (status?.state === 'denied') return false;
  } catch {
    // Navegador que não consulta a permissão da câmera (Firefox, Safari antigo): tenta abrir
  }
  return true;
}

type Step = 'compare' | 'quiz' | 'camera';

interface Props {
  pair: ContrastPair;
  /** Os dois sinais do par, na ordem de `pair.signIds`. */
  signs: [Sign, Sign];
  onComplete: (result: ContrastPairResult) => void;
  /** A etapa da câmera vira palco escuro (o LessonScreen troca o fundo da lição). */
  onStage?: (stage: boolean) => void;
  /** Só para os testes: diz se a câmera está disponível. */
  cameraAvailable?: () => Promise<boolean>;
}

/** Erro ao baixar o pedaço do 3D: a mão vira descrição. */
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

/** Forma da mão e, nas letras com movimento, o movimento (o texto conferido do signs.json). */
function describe(sign: Sign, t: TFunc): string {
  const mov = sign.params.MOV && sign.params.MOV !== 'nenhum' && !/^sem movimento/i.test(sign.params.MOV)
    ? ` ${t('exerciseIntro.movement', { mov: sign.params.MOV })}`
    : '';
  return `${sign.params.CM}.${mov}`;
}

function kindLabel(sign: Sign, t: TFunc): string {
  return sign.category === 'numeros' ? t('exerciseIntro.number', { gloss: sign.gloss }) : t('exerciseIntro.letter', { gloss: sign.gloss });
}

/** A mão em 3D pequena ou, sem 3D, a descrição. */
function PairHand({ sign, playing, label, text, person = 0 }: { sign: Sign; playing: boolean; label: string; text: string; person?: number }) {
  const [failed, setFailed] = useState(false);
  if (!hasHand3d(sign) || failed || !webglAvailable()) {
    return (
      <div className="pair-hand-text">
        <Icon name="sign_language" filled size="24px" />
        <p>{text}</p>
      </div>
    );
  }
  return (
    <Boundary onError={() => setFailed(true)}>
      <Suspense fallback={<div className="mao3d-mini"><div className="mao3d-mini-loading"><Icon name="progress_activity" spin size="24px" /></div></div>}>
        <Mao3DMini gloss={sign.gloss} playing={playing} label={label} person={person} onError={() => setFailed(true)} />
      </Suspense>
    </Boundary>
  );
}

/** Tocar e pausar o movimento das duas mãos juntas (só quando alguma tem movimento). */
function MoveToggle({ playing, onToggle, t }: { playing: boolean; onToggle: () => void; t: TFunc }) {
  return (
    <button type="button" className="sign-demo-btn sign-demo-btn--move pair-move" aria-pressed={playing} onClick={onToggle}>
      {playing ? <Icon name="pause" /> : <TraceArrowIcon />} {t(playing ? 'exerciseContrastPair.pauseMove' : 'exerciseContrastPair.playMove')}
    </button>
  );
}

/**
 * Mãos parecidas (contrast_pair): dois sinais que se confundem (F e T, K e H, O e 0).
 * 1. Compara: as duas mãos em 3D lado a lado, com a forma e o movimento escritos.
 * 2. Checa: uma rodada por sinal, "Qual é a letra F?", escolhendo entre as duas mãos (posições
 *    sorteadas). Nos pares da mesma mão (O e 0, S e 8) a escolha é pelo contexto: a mão aparece
 *    numa palavra ou num número.
 * 3. Câmera: os sinais de `pair.camera`, um depois do outro, cada um com o seu reconhecedor. Sem
 *    nenhum sinal com câmera, ou sem câmera no aparelho, a etapa é pulada.
 */
export function ExerciseContrastPair({ pair, signs, onComplete, onStage, cameraAvailable = cameraUsable }: Props) {
  const { t } = useT();
  const bySign = (id: string) => (id === signs[0].id ? signs[0] : signs[1]);
  const sameHand = !!pair.contexts;
  const moving = signs.some((s) => isMovingLetter(s.gloss));
  const [playing, setPlaying] = useState(() => !prefersReducedMotion());
  const [step, setStep] = useState<Step>('compare');
  const [round, setRound] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [missed] = useState(() => new Set<string>());
  const [quizOk, setQuizOk] = useState(true);
  const [camIdx, setCamIdx] = useState(0);
  const [camOk, setCamOk] = useState(true);
  const doneRef = useRef(false);

  const onStageRef = useRef(onStage);
  onStageRef.current = onStage;
  useEffect(() => {
    onStageRef.current?.(step === 'camera');
  }, [step]);
  useEffect(() => () => onStageRef.current?.(false), []);

  function finish(cameraCorrect: boolean) {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete({ correct: quizOk && cameraCorrect, missed: [...missed] });
  }

  async function afterQuiz() {
    if (pair.camera.length && await cameraAvailable()) {
      setStep('camera');
      return;
    }
    finish(true);
  }

  function nextRound() {
    if (round + 1 < pair.rounds.length) {
      setRound(round + 1);
      setPicked(null);
      return;
    }
    void afterQuiz();
  }

  function answer(id: string) {
    if (picked) return;
    const target = pair.rounds[round].target;
    const correct = id === target;
    setPicked(id);
    if (correct) { Haptics.correct(); Sfx.correct(); } else {
      Sfx.neutral();
      setQuizOk(false);
      missed.add(target);
    }
  }

  function cameraDone(signId: string, correct: boolean) {
    if (!correct) {
      setCamOk(false);
      missed.add(signId);
    }
    const ok = camOk && correct;
    if (camIdx + 1 < pair.camera.length) setCamIdx(camIdx + 1);
    else finish(ok);
  }

  if (step === 'camera') {
    const cur = pair.camera[camIdx];
    const sign = bySign(cur.signId);
    const done = (correct: boolean) => cameraDone(cur.signId, correct);
    return (
      <div className="pair-camera">
        <p className="pair-camera-count">
          <Icon name="swap_horiz" />{' '}
          {pair.camera.length > 1
            ? t('exerciseContrastPair.cameraStep', { n: camIdx + 1, total: pair.camera.length })
            : t('exerciseContrastPair.title')}
        </p>
        <CameraStep key={cur.signId} recognizer={cur.recognizer} sign={sign} onComplete={done} />
      </div>
    );
  }

  if (step === 'compare') {
    return (
      <div className="exercise-screen pair-screen">
        <div className="pair-head">
          <span className="pair-chip"><Icon name="swap_horiz" /> {t('exerciseContrastPair.title')}</span>
          {sameHand && <span className="pair-chip pair-chip--same">{t('exerciseContrastPair.sameHand')}</span>}
        </div>
        <h2 className="exercise-prompt">{t('exerciseContrastPair.comparePrompt')}</h2>
        <p className="pair-hint">{sameHand ? t('exerciseContrastPair.sameHandNote') : t('exerciseContrastPair.compareHint')}</p>
        <div className="pair-hands">
          {signs.map((s) => (
            <figure key={s.id} className="pair-card">
              <PairHand sign={s} playing={playing} label={`${kindLabel(s, t)}: ${describe(s, t)}`} text={describe(s, t)} />
              <figcaption className="pair-card-caption">
                <span className="pair-gloss">{s.gloss}</span>
                <span className="pair-kind">{kindLabel(s, t)}</span>
                {isMovingLetter(s.gloss) && (
                  <span className="pair-chip pair-chip--move"><TraceArrowIcon /> {t('exerciseContrastPair.withMovement')}</span>
                )}
                <span className="pair-desc">{describe(s, t)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
        {moving && <MoveToggle playing={playing} onToggle={() => setPlaying((v) => !v)} t={t} />}
        <div className="exercise-intro-footer">
          <button className="btn btn-primary" onClick={() => setStep('quiz')}>
            {t('exerciseIntro.understood')} <Icon name="arrow_forward" />
          </button>
        </div>
      </div>
    );
  }

  // Checagem
  const r = pair.rounds[round];
  const target = bySign(r.target);
  const answered = picked !== null;
  const isCorrect = picked === r.target;
  const glosses = signs.map((s) => s.gloss);
  const roundLabel = t('exerciseContrastPair.round', { n: round + 1, total: pair.rounds.length });

  if (sameHand) {
    const context = pair.contexts?.[r.target] ?? '';
    const prompt = t(target.category === 'numeros' ? 'exerciseContrastPair.contextNumber' : 'exerciseContrastPair.contextWord', { context });
    return (
      <div className="exercise-screen pair-screen" key={round}>
        <p className="pair-round">{roundLabel}</p>
        <h2 className="exercise-prompt" id="pair-prompt">{prompt}</h2>
        <div className="pair-context">
          <div className="pair-card pair-card--single">
            <PairHand sign={target} playing={playing} label={describe(target, t)} text={describe(target, t)} person={round + 1} />
          </div>
          <span className="pair-context-word tabular" aria-hidden="true">{context}</span>
        </div>
        <div className="mc-grid" role="group" aria-labelledby="pair-prompt">
          {r.order.map((id) => {
            const s = bySign(id);
            const isRight = answered && id === r.target;
            const isWrongPick = answered && id === picked && !isRight;
            let cls = 'mc-choice pair-option';
            if (isRight) cls += isCorrect ? ' mc-choice--correct' : ' reveal-correct';
            else if (isWrongPick) cls += ' mc-choice--wrong';
            else if (answered) cls += ' mc-choice--dimmed';
            return (
              <button key={id} className={cls} onClick={() => answer(id)} disabled={answered && !isRight && !isWrongPick}>
                {isRight && <Icon name="check" className="mc-icon" />}
                {isWrongPick && <Icon name="close" className="mc-icon" />}
                <span className="mc-choice-text">{kindLabel(s, t)}</span>
                {isRight && !isCorrect && <span className="mc-choice-tag">{t('feedback.rightAnswer')}</span>}
              </button>
            );
          })}
        </div>
        {answered && (
          <FeedbackPanel
            tone={isCorrect ? 'correct' : 'wrong'}
            title={isCorrect ? t('exerciseContrastPair.correct') : t('feedback.almost')}
            body={isCorrect
              ? <span className="feedback-gloss">{kindLabel(target, t)}</span>
              : <>{t('exerciseContrastPair.wrongContext')} <strong className="feedback-gloss">{kindLabel(target, t)}</strong></>}
            actionLabel={t('common.continue')}
            onAction={nextRound}
          />
        )}
      </div>
    );
  }

  const prompt = t(target.category === 'numeros' ? 'exerciseContrastPair.whichNumber' : 'exerciseContrastPair.whichLetter', { gloss: target.gloss });
  const rightN = r.order.indexOf(r.target) + 1;
  return (
    <div className="exercise-screen pair-screen" key={round}>
      <p className="pair-round">{roundLabel}</p>
      <h2 className="exercise-prompt" id="pair-prompt">{prompt}</h2>
      <p className="pair-hint">{t('exerciseContrastPair.pickHint')}</p>
      <div className="pair-hands" role="group" aria-labelledby="pair-prompt">
        {r.order.map((id, i) => {
          const s = bySign(id);
          const n = i + 1;
          // Antes de responder, a descrição não diz qual sinal é
          const text = answered ? describe(s, t) : maskChoiceCaption(describe(s, t), s.gloss, glosses);
          const isRight = answered && id === r.target;
          const isWrongPick = answered && id === picked && !isRight;
          let cls = 'pair-card pair-pick';
          if (isRight) cls += isCorrect ? ' pair-pick--correct' : ' pair-pick--reveal';
          else if (isWrongPick) cls += ' pair-pick--wrong';
          else if (answered) cls += ' pair-pick--dimmed';
          return (
            <button
              key={id}
              type="button"
              className={cls}
              onClick={() => answer(id)}
              aria-disabled={answered || undefined}
              aria-label={t('exerciseContrastPair.handLabel', { n, desc: text })}
            >
              <PairHand sign={s} playing={playing} label={t('exerciseContrastPair.handLabel', { n, desc: text })} text={text} person={round + 1} />
              <span className="pair-pick-label">
                <span className="pair-pick-badge tabular" aria-hidden="true">
                  {isRight ? <Icon name="check" /> : isWrongPick ? <Icon name="close" /> : n}
                </span>
                {answered ? kindLabel(s, t) : t('exerciseContrastPair.hand', { n })}
              </span>
              {isRight && !isCorrect && <span className="pair-pick-tag">{t('feedback.rightAnswer')}</span>}
            </button>
          );
        })}
      </div>
      {moving && <MoveToggle playing={playing} onToggle={() => setPlaying((v) => !v)} t={t} />}
      {answered && (
        <FeedbackPanel
          tone={isCorrect ? 'correct' : 'wrong'}
          title={isCorrect ? t('exerciseContrastPair.correct') : t('feedback.almost')}
          body={isCorrect
            ? <span className="feedback-gloss">{kindLabel(target, t)}</span>
            : t('exerciseContrastPair.wrongHand', { n: rightN })}
          actionLabel={t('common.continue')}
          onAction={nextRound}
        />
      )}
    </div>
  );
}

/** Um sinal na câmera com o reconhecedor certo (o mesmo do perform_sign). */
function CameraStep({ recognizer, sign, onComplete }: { recognizer: CameraRecognizer; sign: Sign; onComplete: (correct: boolean) => void }) {
  if (recognizer === 'letras-mov') return <ExerciseCameraMotionLetter sign={sign} onComplete={onComplete} />;
  if (recognizer === 'sinais') return <ExerciseCameraMotionSign sign={sign} onComplete={onComplete} />;
  return <ExerciseCameraSign sign={sign} recognizer={recognizer === 'numeros' ? 'numeros' : undefined} onComplete={onComplete} />;
}
