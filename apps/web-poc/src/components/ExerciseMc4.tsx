import { useState } from 'react';
import { maskChoiceCaption, type Sign } from '../lib/content';
import { useT } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';

interface Props {
  sign: Sign;
  choices: string[];
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

type State = 'waiting' | 'correct' | 'wrong';

export function ExerciseMc4({ sign, choices, onAnswer, onNext }: Props) {
  const { t } = useT();
  const [state, setState] = useState<State>('waiting');
  const [chosen, setChosen] = useState<string | null>(null);

  function select(gloss: string) {
    if (state !== 'waiting') return;
    const correct = gloss === sign.gloss;
    setChosen(gloss);
    setState(correct ? 'correct' : 'wrong');
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
  }

  // Estados da alternativa (seção 11.2 da proposta): correta, incorreta, revelada e desabilitada
  function choiceClass(gloss: string): string {
    if (state === 'waiting') return 'mc-choice';
    if (gloss === sign.gloss) return state === 'correct' ? 'mc-choice selected-correct' : 'mc-choice reveal-correct';
    if (gloss === chosen) return 'mc-choice selected-wrong';
    return 'mc-choice mc-choice--dimmed';
  }

  const movNote = sign.recognition === 'dynamic' ? ` ${t('exerciseMc4.movementNote', { mov: sign.params.MOV })}` : '';
  const description = (state === 'waiting' ? maskChoiceCaption(sign.video_caption, sign.gloss, choices) : sign.video_caption) + movNote;

  return (
    <div className="exercise-screen">
      <div className="mc-question">
        <p className="mc-question-label">
          {sign.category === 'alfabeto'
            ? t('exerciseMc4.question')
            : sign.category === 'numeros'
              ? t('exerciseMc4.questionNumber')
              : t('exerciseMc4.questionSign')}
        </p>
        <p>{description}</p>
      </div>

      <div className="mc-choices">
        {choices.map((gloss) => {
          const isRight = state !== 'waiting' && gloss === sign.gloss;
          const isWrongPick = state === 'wrong' && gloss === chosen;
          return (
            <button
              key={gloss}
              className={choiceClass(gloss)}
              onClick={() => select(gloss)}
              disabled={state !== 'waiting'}
            >
              {isRight && <Icon name="check" className="mc-icon" />}
              {isWrongPick && <Icon name="close" className="mc-icon" />}
              <span className="mc-choice-text">{gloss}</span>
              {isRight && state === 'wrong' && (
                <span className="mc-choice-tag">{t('feedback.rightAnswer')}</span>
              )}
            </button>
          );
        })}
      </div>

      {state === 'correct' && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseMc4.correct')}
          body={<span className="feedback-gloss">{sign.gloss}</span>}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}

      {state === 'wrong' && (
        <FeedbackPanel
          tone="wrong"
          title={t('feedback.almost')}
          body={t('exerciseMc4.wasGloss', { gloss: sign.gloss })}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
