import { useState } from 'react';
import { maskGloss, shuffle, type Sign } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { Sfx } from '../lib/sound';

interface Props {
  signs: Sign[];
  /** `missed`: sinais que tiveram par errado (para o SRS revisar mais cedo). */
  onComplete: (allCorrect: boolean, missed: string[]) => void;
}

type PairState = 'idle' | 'correct' | 'wrong';

interface CardState {
  signId: string;
  pairState: PairState;
  matchedGloss: string | null;
}

export function ExerciseMatchPairs({ signs, onComplete }: Props) {
  const { t } = useT();
  const [cards, setCards] = useState<CardState[]>(
    signs.map(s => ({ signId: s.id, pairState: 'idle', matchedGloss: null })),
  );
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  // A coluna das palavras não segue a ordem das descrições (senão a posição entrega o par)
  const [glossOrder] = useState(() => shuffle(signs));

  const signMap = Object.fromEntries(signs.map(s => [s.id, s]));

  function selectCard(signId: string) {
    if (done) return;
    const card = cards.find(c => c.signId === signId);
    if (!card || card.pairState === 'correct') return;
    setSelectedCard(prev => prev === signId ? null : signId);
  }

  function selectGloss(gloss: string) {
    if (!selectedCard || done) return;
    const sign = signMap[selectedCard];
    if (!sign) return;

    const isCorrect = sign.gloss === gloss;

    const next = cards.map(c =>
      c.signId === selectedCard
        ? { ...c, pairState: isCorrect ? ('correct' as PairState) : ('wrong' as PairState), matchedGloss: gloss }
        : c,
    );
    setCards(next);
    setSelectedCard(null);

    if (isCorrect) Sfx.correct(); else Sfx.neutral();

    if (!isCorrect) {
      if (!missed.includes(selectedCard)) setMissed([...missed, selectedCard]);
      setTimeout(() => {
        setCards(prev =>
          prev.map(c => c.signId === selectedCard ? { ...c, pairState: 'idle', matchedGloss: null } : c),
        );
      }, 900);
      return;
    }

    const allDone = next.every(c => c.pairState === 'correct');
    if (allDone) {
      setDone(true);
      onComplete(missed.length === 0, missed);
    }
  }

  const matchedGlosses = new Set(cards.filter(c => c.pairState === 'correct').map(c => signMap[c.signId]?.gloss));

  return (
    <div className="exercise-screen">
      <div className="mc-question">
        <p className="mc-question-label">
          {signs.every(s => s.category === 'alfabeto')
            ? t('exerciseMatchPairs.question')
            : signs.every(s => s.category === 'numeros')
              ? t('exerciseMatchPairs.questionNumber')
              : t('exerciseMatchPairs.questionSign')}
        </p>
      </div>

      <div className="pairs-layout">
        <div className="pairs-descriptions">
          {cards.map(card => {
            const sign = signMap[card.signId];
            const isSelected = selectedCard === card.signId;
            return (
              <button
                key={card.signId}
                className={`pair-card${isSelected ? ' pair-card--selected' : ''} pair-card--${card.pairState}${card.pairState === 'wrong' ? ' animate__animated animate__headShake' : ''}${card.pairState === 'correct' ? ' animate__animated animate__pulse' : ''}`}
                onClick={() => selectCard(card.signId)}
                disabled={card.pairState === 'correct'}
                data-selected={isSelected ? 'true' : undefined}
              >
                {card.pairState === 'correct' && (
                  <Icon name="check" className="pair-icon pair-icon--ok" />
                )}
                {card.pairState === 'wrong' && (
                  <Icon name="close" className="pair-icon pair-icon--err" />
                )}
                {/* A descrição não pode trazer a palavra de nenhum par */}
                <span>{sign ? signs.reduce((text, s) => maskGloss(text, s.gloss), sign.video_caption) : null}</span>
              </button>
            );
          })}
        </div>

        <div className="pairs-glosses">
          {glossOrder.map(sign => (
            <button
              key={sign.id}
              className={`mc-choice${matchedGlosses.has(sign.gloss) ? ' selected-correct' : ''}`}
              onClick={() => selectGloss(sign.gloss)}
              disabled={matchedGlosses.has(sign.gloss)}
            >
              {sign.gloss}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
