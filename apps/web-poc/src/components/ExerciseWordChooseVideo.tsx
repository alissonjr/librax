import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { maskChoiceCaption, maskGloss, type Sign } from '../lib/content';
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

/**
 * Descrição sem a resposta: esconde a glosa da própria opção, a palavra do enunciado e as
 * glosas das outras opções citadas nela (ex.: "como no sinal FILHO" na descrição de FILHA).
 */
export function maskedCaption(option: Sign, word: string, options: Sign[] = []): string {
  const others = options.map(o => o.gloss);
  return maskGloss(maskChoiceCaption(option.video_caption, option.gloss, others), word);
}

/**
 * "Qual é o sinal de <PALAVRA>?" (spec-03 11.4). As 4 opções são cartões num radiogroup: tocar no
 * cartão seleciona a opção e toca a demonstração dela no palco de cima (um palco só, porque o
 * avatar VLibras é uma instância única e o vídeo pesa no celular). Selecionar não corrige: a pessoa
 * compara quantas quiser e a correção só acontece no botão Verificar. Opção sem vídeo nem avatar
 * mostra a descrição no próprio cartão.
 */
export function ExerciseWordChooseVideo({ word, sign, options, onAnswer, onNext }: Props) {
  const { t } = useT();
  const vl = useSyncExternalStore(subscribeVlibras, getVlibrasState);
  const [selected, setSelected] = useState<string | null>(null);
  const [answered, setAnswered] = useState<string | null>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);
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
  const selectedIdx = options.findIndex(o => o.id === selected);
  const selectedSign = selectedIdx >= 0 ? options[selectedIdx] : null;
  const correctIdx = options.findIndex(o => o.id === sign.id);

  function select(i: number) {
    if (showFeedback) return;
    setSelected(options[i].id);
  }

  // Radiogroup: setas movem a seleção (e o foco) entre os cartões
  function handleKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (!step || showFeedback) return;
    e.preventDefault();
    const j = (i + step + options.length) % options.length;
    select(j);
    radios.current[j]?.focus();
  }

  function handleCheck() {
    if (!selected || answered) return;
    const correct = selected === sign.id;
    setAnswered(selected);
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
    if (correct) setTimeout(next, 1000);
  }

  // Foco do radiogroup: no selecionado ou, sem seleção, no primeiro
  const focusIdx = selectedIdx >= 0 ? selectedIdx : 0;

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt" id="wcv-prompt">
        {t('exerciseWordChooseVideo.prompt')} <strong className="wcv-word">{word}</strong>
      </h2>

      <div className="wcv-stage">
        {selectedSign ? (
          <>
            <p className="wcv-stage-title" aria-live="polite">{t('exerciseWordChooseVideo.playing', { n: selectedIdx + 1 })}</p>
            <SignDemo
              key={selectedSign.id}
              sign={selectedSign}
              conceal={!showFeedback}
              className="sign-demo--choose"
              fallback={
                // Em modo texto o cartão já mostra a descrição: o palco fica só com o aviso do avatar
                chooseDemoMode(selectedSign, avatarFailed) === 'text' ? null : (
                  <p className="wcv-stage-text">
                    {showFeedback ? selectedSign.video_caption : maskedCaption(selectedSign, word, options)}
                  </p>
                )
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

      <div className="wcv-options" role="radiogroup" aria-labelledby="wcv-prompt">
        {options.map((option, i) => {
          const n = i + 1;
          const textOnly = chooseDemoMode(option, avatarFailed) === 'text';
          const isSelected = selected === option.id;
          const isRight = showFeedback && option.id === sign.id;
          const isWrongPick = showFeedback && option.id === answered && !isRight;
          let cls = 'wcv-option';
          if (isRight) cls += isCorrect ? ' wcv-option--correct' : ' wcv-option--reveal';
          else if (isWrongPick) cls += ' wcv-option--wrong';
          else if (showFeedback) cls += ' wcv-option--dimmed';
          else if (isSelected) cls += ' wcv-option--selected';
          return (
            <button
              key={option.id}
              ref={el => { radios.current[i] = el; }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-disabled={showFeedback || undefined}
              tabIndex={i === focusIdx ? 0 : -1}
              className={cls}
              onClick={() => select(i)}
              onKeyDown={e => handleKey(e, i)}
            >
              <span className="wcv-badge tabular" aria-hidden="true">
                {isRight ? <Icon name="check" /> : isWrongPick ? <Icon name="close" /> : n}
              </span>
              <span className="wcv-pick-text">
                <span className="wcv-pick-label">
                  {showFeedback ? option.gloss : t('exerciseWordChooseVideo.option', { n })}
                </span>
                {textOnly && (
                  <span className="wcv-desc">{showFeedback ? option.video_caption : maskedCaption(option, word, options)}</span>
                )}
                {isRight && !isCorrect && <span className="wcv-tag">{t('feedback.rightAnswer')}</span>}
              </span>
              {!textOnly && !showFeedback && (
                <Icon name="play_arrow" className="wcv-play" />
              )}
            </button>
          );
        })}
      </div>

      {!showFeedback && (
        <div className="wcv-check-bar">
          <button className="btn btn-primary" onClick={handleCheck} disabled={!selected}>
            {t('exerciseWordChooseVideo.check')}
          </button>
        </div>
      )}

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
