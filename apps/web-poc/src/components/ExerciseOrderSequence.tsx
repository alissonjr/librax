import { useState, useRef } from 'react';
import { useT } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';

interface Props {
  steps: string[];
  correctOrder: number[];
  /** Texto do enunciado; sem ele, usa o enunciado padrao de ordenacao. */
  prompt?: string;
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

export function ExerciseOrderSequence({ steps, correctOrder, prompt, onAnswer, onNext }: Props) {
  const { t } = useT();
  const [order, setOrder] = useState<number[]>(() => [...steps.keys()].sort(() => Math.random() - 0.5));
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const dragIdx = useRef<number | null>(null);

  function onDragStart(i: number) { dragIdx.current = i; }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === i) return;
    const next = [...order];
    const [moved] = next.splice(dragIdx.current, 1);
    next.splice(i, 0, moved);
    dragIdx.current = i;
    setOrder(next);
  }

  function handleConfirm() {
    const correct = order.every((step, i) => step === correctOrder[i]);
    setAnswered(true);
    setIsCorrect(correct);
    if (correct) Haptics.correct();
    onAnswer(correct);
    if (correct) setTimeout(onNext, 1000);
  }

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt">{prompt ?? t('exerciseOrderSequence.prompt')}</h2>

      <div className="order-list">
        {order.map((stepIdx, position) => {
          let cls = 'order-item';
          if (answered) {
            cls += stepIdx === correctOrder[position] ? ' order-item--correct' : ' order-item--wrong';
          }
          return (
            <div
              key={stepIdx}
              className={cls}
              draggable={!answered}
              onDragStart={() => onDragStart(position)}
              onDragOver={e => onDragOver(e, position)}
            >
              <Icon name="drag_indicator" className="order-grip" />
              <span>{steps[stepIdx]}</span>
              {answered && stepIdx === correctOrder[position] && (
                <Icon name="check" className="order-status-icon order-status-icon--ok" />
              )}
              {answered && stepIdx !== correctOrder[position] && (
                <Icon name="close" className="order-status-icon order-status-icon--err" />
              )}
            </div>
          );
        })}
      </div>

      {!answered && (
        <button className="btn btn-primary" onClick={handleConfirm}>
          {t('exerciseOrderSequence.confirm')}
        </button>
      )}

      {answered && !isCorrect && (
        <FeedbackPanel
          tone="wrong"
          title={t('feedback.almost')}
          body={t('exerciseOrderSequence.correctOrder')}
          actionLabel={t('common.continue')}
          onAction={onNext}
        >
          <ol className="order-correct-list">
            {correctOrder.map((stepIdx, i) => (
              <li key={i} className="order-correct-item">{i + 1}. {steps[stepIdx]}</li>
            ))}
          </ol>
        </FeedbackPanel>
      )}
      {answered && isCorrect && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseOrderSequence.correct')}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
