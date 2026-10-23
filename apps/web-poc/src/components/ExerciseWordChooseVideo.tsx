import { useRef, useState, useSyncExternalStore } from 'react';
import { maskGloss, type Sign } from '../lib/content';
import { getVlibrasState, subscribeVlibras } from '../lib/vlibras';
import { useT } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';
import { SignDemo, chooseDemoMode } from './SignDemo';

interface Props {
  /** A palavra do enunciado (glosa do sinal certo). */
  word: string;
  /** O sinal certo. */
  sign: Sign;
  /** As 4 opções, já na ordem sorteada (o sinal certo está entre elas). */
  options: Sign[];
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

/** Descrição sem a resposta: esconde a glosa da própria opção e a palavra do enunciado. */
export function maskedCaption(option: Sign, word: string): string {
  return maskGloss(maskGloss(option.video_caption, option.gloss), word);
}

/**
 * "Qual é o sinal de <PALAVRA>?" (spec-03 11.4). As 4 opções são cartões; a demonstração toca
 * sob demanda num palco só, uma de cada vez (o avatar VLibras é uma instância única e o vídeo
 * pesa no celular). Ver a demonstração e escolher a opção são botões separados, para assistir
 * não contar como resposta. Opção sem vídeo nem avatar mostra a descrição no próprio cartão.
 */
export function ExerciseWordChooseVideo({ word, sign, options, onAnswer, onNext }: Props) {
  const { t } = useT();
  const vl = useSyncExternalStore(subscribeVlibras, getVlibrasState);
  const [viewing, setViewing] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  // O avanço automático e o botão Continuar não podem avançar duas vezes
  const leftRef = useRef(false);
  const next = () => {
    if (leftRef.current) return;
    leftRef.current = true;
    onNext();
  };

  const showFeedback = answered !== null;
  const isCorrect = answered === sign.id;
  const avatarFailed = vl.status === 'error';
  const viewingIdx = options.findIndex(o => o.id === viewing);
  const viewingSign = viewingIdx >= 0 ? options[viewingIdx] : null;
  const correctIdx = options.findIndex(o => o.id === sign.id);

  function handlePick(option: Sign) {
    if (answered) return;
    const correct = option.id === sign.id;
    setAnswered(option.id);
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
    if (correct) setTimeout(next, 1000);
  }

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt">
        {t('exerciseWordChooseVideo.prompt')} <strong className="wcv-word">{word}</strong>
      </h2>

      <div className="wcv-stage" aria-live="polite">
        {viewingSign ? (
          <>
            <p className="wcv-stage-title">{t('exerciseWordChooseVideo.option', { n: viewingIdx + 1 })}</p>
            <SignDemo
              key={viewingSign.id}
              sign={viewingSign}
              conceal={!showFeedback}
              className="sign-demo--choose"
              fallback={
                <p className="wcv-stage-text">
                  {showFeedback ? viewingSign.video_caption : maskedCaption(viewingSign, word)}
                </p>
              }
            />
          </>
        ) : (
          <div className="wcv-stage-empty">
            <Icon name="play_arrow" size="32px" />
            <p>{t('exerciseWordChooseVideo.stageEmpty')}</p>
          </div>
        )}
      </div>

      <ul className="wcv-options">
        {options.map((option, i) => {
          const n = i + 1;
          const textOnly = chooseDemoMode(option, avatarFailed) === 'text';
          const isRight = showFeedback && option.id === sign.id;
          const isWrongPick = showFeedback && option.id === answered && !isRight;
          let cls = 'wcv-option';
          if (isRight) cls += isCorrect ? ' wcv-option--correct' : ' wcv-option--reveal';
          else if (isWrongPick) cls += ' wcv-option--wrong';
          else if (showFeedback) cls += ' wcv-option--dimmed';
          if (viewing === option.id) cls += ' wcv-option--viewing';
          return (
            <li key={option.id} className={cls}>
              <button
                type="button"
                className="wcv-pick"
                onClick={() => handlePick(option)}
                disabled={showFeedback}
                aria-label={showFeedback ? undefined : t('exerciseWordChooseVideo.chooseLabel', { n })}
              >
                <span className="wcv-badge tabular" aria-hidden="true">
                  {isRight ? <Icon name="check" /> : isWrongPick ? <Icon name="close" /> : n}
                </span>
                <span className="wcv-pick-text">
                  <span className="wcv-pick-label">
                    {showFeedback ? option.gloss : t('exerciseWordChooseVideo.option', { n })}
                  </span>
                  {textOnly && (
                    <span className="wcv-desc">{showFeedback ? option.video_caption : maskedCaption(option, word)}</span>
                  )}
                  {isRight && !isCorrect && <span className="wcv-tag">{t('feedback.rightAnswer')}</span>}
                </span>
              </button>
              {!textOnly && (
                <button
                  type="button"
                  className="wcv-view"
                  onClick={() => setViewing(viewing === option.id ? null : option.id)}
                  aria-pressed={viewing === option.id}
                  aria-label={t('exerciseWordChooseVideo.viewLabel', { n })}
                >
                  <Icon name={viewing === option.id ? 'stop' : 'play_arrow'} />
                  <span>{t(viewing === option.id ? 'exerciseWordChooseVideo.hide' : 'exerciseWordChooseVideo.view')}</span>
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {showFeedback && !isCorrect && (
        <FeedbackPanel
          tone="wrong"
          title={t('feedback.almost')}
          body={<>{t('exerciseWordChooseVideo.correctAnswer', { n: correctIdx + 1 })} <strong className="feedback-gloss">{sign.gloss}</strong></>}
          actionLabel={t('common.continue')}
          onAction={next}
        />
      )}
      {showFeedback && isCorrect && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseWordChooseVideo.correct')}
          body={<span className="feedback-gloss">{sign.gloss}</span>}
          actionLabel={t('common.continue')}
          onAction={next}
        />
      )}
    </div>
  );
}
