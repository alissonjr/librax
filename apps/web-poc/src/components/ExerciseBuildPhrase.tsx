import { useState } from 'react';
import { useT } from '../i18n';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
import { Icon } from './Icon';
import { FeedbackPanel } from './FeedbackPanel';

interface Props {
  /** Traducao em portugues mostrada como enunciado. */
  pt: string;
  /** Glosas da frase na ordem certa da Libras. */
  glosses: string[];
  /** Blocos disponiveis, ja embaralhados (glosas da frase + distratores). */
  tiles: string[];
  onAnswer: (correct: boolean) => void;
  onNext: () => void;
}

/**
 * Montar a frase (build_phrase): a pessoa toca nos blocos de glosa na ordem da Libras.
 * Tocar num bloco ja colocado devolve o bloco para o banco. A comparacao e pelo texto,
 * entao glosas repetidas na frase (ex.: EU ... EU) valem em qualquer um dos blocos iguais.
 */
export function ExerciseBuildPhrase({ pt, glosses, tiles, onAnswer, onNext }: Props) {
  const { t } = useT();
  /** Indices de `tiles` na ordem em que foram colocados. */
  const [placed, setPlaced] = useState<number[]>([]);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  function place(tileIdx: number) {
    if (answered || placed.includes(tileIdx)) return;
    setPlaced((p) => [...p, tileIdx]);
  }

  function giveBack(tileIdx: number) {
    if (answered) return;
    setPlaced((p) => p.filter((i) => i !== tileIdx));
  }

  function handleConfirm() {
    const built = placed.map((i) => tiles[i]);
    const correct = built.length === glosses.length && built.every((g, i) => g === glosses[i]);
    setAnswered(true);
    setIsCorrect(correct);
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
  }

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt">{t('exerciseBuildPhrase.prompt')}</h2>

      <div className="phrase-pt">
        <span className="phrase-pt-label">{t('exerciseBuildPhrase.ptLabel')}</span>
        <p className="phrase-pt-text">{pt}</p>
      </div>

      <div
        className={`phrase-answer${answered ? (isCorrect ? ' phrase-answer--correct' : ' phrase-answer--wrong') : ''}`}
        aria-label={t('exerciseBuildPhrase.answerLabel')}
        role="group"
      >
        {placed.length === 0 && <p className="phrase-answer-empty">{t('exerciseBuildPhrase.emptyHint')}</p>}
        {placed.map((tileIdx) => (
          <button
            key={tileIdx}
            type="button"
            className="phrase-tile phrase-tile--placed"
            onClick={() => giveBack(tileIdx)}
            disabled={answered}
            aria-label={t('exerciseBuildPhrase.removeTile', { gloss: tiles[tileIdx] })}
          >
            {tiles[tileIdx]}
          </button>
        ))}
      </div>

      <div className="phrase-bank" role="group" aria-label={t('exerciseBuildPhrase.bankLabel')}>
        {tiles.map((gloss, tileIdx) => {
          const used = placed.includes(tileIdx);
          return (
            <button
              key={tileIdx}
              type="button"
              className={`phrase-tile${used ? ' phrase-tile--used' : ''}`}
              onClick={() => place(tileIdx)}
              disabled={answered || used}
              aria-hidden={used || undefined}
              tabIndex={used ? -1 : undefined}
            >
              {gloss}
            </button>
          );
        })}
      </div>

      <p className="phrase-note">
        <Icon name="info" className="phrase-note-icon" />
        {t('exerciseBuildPhrase.orderNote')}
      </p>

      {!answered && (
        <button className="btn btn-primary" onClick={handleConfirm} disabled={placed.length === 0}>
          {t('exerciseBuildPhrase.confirm')}
        </button>
      )}

      {answered && !isCorrect && (
        <FeedbackPanel
          tone="wrong"
          title={t('feedback.almost')}
          body={t('exerciseBuildPhrase.correctOrder')}
          actionLabel={t('common.continue')}
          onAction={onNext}
        >
          <ol className="phrase-correct" aria-label={t('exerciseBuildPhrase.correctOrder')}>
            {glosses.map((g, i) => (
              <li key={i} className="phrase-correct-item feedback-gloss">{g}</li>
            ))}
          </ol>
        </FeedbackPanel>
      )}
      {answered && isCorrect && (
        <FeedbackPanel
          tone="correct"
          title={t('exerciseBuildPhrase.correct')}
          actionLabel={t('common.continue')}
          onAction={onNext}
        />
      )}
    </div>
  );
}
