import { useState } from 'react';
import { maskChoiceCaption, type Sign } from '../lib/content';
import { useT } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';
import { SignDemo } from './SignDemo';

interface Props {
  sign: Sign;
  choices: string[];
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

export function ExerciseWatchChooseWord({ sign, choices, onAnswer, onNext }: Props) {
  const { t } = useT();
  const [answered, setAnswered] = useState<string | null>(null);

  function handleChoice(gloss: string) {
    if (answered) return;
    const correct = gloss === sign.gloss;
    setAnswered(gloss);
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
    if (correct) setTimeout(onNext, 1000);
  }

  const showFeedback = answered !== null;
  const isCorrect = answered === sign.gloss;

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt">{t('exerciseWatchChooseWord.prompt')}</h2>

      {/* Vídeo, avatar VLibras ou descrição. Nada pode entregar a resposta: rótulo sem a glosa,
          legenda do avatar desligada e descrição mascarada até responder. */}
      <SignDemo
        sign={sign}
        conceal={!showFeedback}
        className="sign-demo--watch"
        fallback={
          <div className="exercise-video-wrap">
            <div className="exercise-video-placeholder">
              {showFeedback && <div className="exercise-video-gloss">{sign.gloss}</div>}
              <p className="exercise-video-caption">{showFeedback ? sign.video_caption : maskChoiceCaption(sign.video_caption, sign.gloss, choices)}</p>
            </div>
          </div>
        }
      />

      <div className="mc-grid">
        {choices.map(gloss => {
          let cls = 'mc-choice';
          const isRight = showFeedback && gloss === sign.gloss;
          const isWrongPick = showFeedback && gloss === answered && !isRight;
          if (isRight) cls += isCorrect ? ' mc-choice--correct' : ' reveal-correct';
          else if (isWrongPick) cls += ' mc-choice--wrong';
          else if (showFeedback) cls += ' mc-choice--dimmed';
          return (
            <button
              key={gloss}
              className={cls}
              onClick={() => handleChoice(gloss)}
              disabled={showFeedback && gloss !== answered && gloss !== sign.gloss}
            >
              {isRight && <Icon name="check" className="mc-icon" />}
              {isWrongPick && <Icon name="close" className="mc-icon" />}
              <span className="mc-choice-text">{gloss}</span>
              {isRight && !isCorrect && <span className="mc-choice-tag">{t('feedback.rightAnswer')}</span>}
            </button>
          );
        })}
      </div>

      {showFeedback && !isCorrect && (
        <FeedbackPanel
          tone="wrong"
          title={t('feedback.almost')}
          body={<>{t('exerciseWatchChooseWord.correctAnswer')} <strong className="feedback-gloss">{sign.gloss}</strong></>}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
      {showFeedback && isCorrect && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseWatchChooseWord.correct')}
          body={<span className="feedback-gloss">{sign.gloss}</span>}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
