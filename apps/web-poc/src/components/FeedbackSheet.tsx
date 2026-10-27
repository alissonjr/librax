import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { useCloseOnBack } from '../hooks/useCloseOnBack';
import { FEEDBACK_TEXT_MAX, sendFeedback } from '../lib/telemetry';
import { markFeedbackAnswered } from '../lib/feedbackPrompt';
import '../styles/feedback.css';

interface Props {
  /** "Agora não", Esc, voltar ou toque fora: pergunta de novo mais tarde (lib/feedbackPrompt.ts). */
  onDismiss: () => void;
  /** Depois do "Obrigado": fecha. */
  onDone: () => void;
}

const STARS = [1, 2, 3, 4, 5] as const;
const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Nota do app de 1 a 5 e comentário opcional (lib/telemetry.ts, sendFeedback). Tocar numa estrela
 * já manda, com o que estiver escrito na caixa. Diálogo modal com o foco preso dentro: Tab e
 * Shift+Tab circulam, Esc fecha. O texto avisa para não escrever dados pessoais.
 */
export function FeedbackSheet({ onDismiss, onDone }: Props) {
  const { t } = useT();
  const id = useId();
  const [phase, setPhase] = useState<'ask' | 'sending' | 'thanks'>('ask');
  const [text, setText] = useState('');
  const [hover, setHover] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const close = phase === 'thanks' ? onDone : onDismiss;
  useCloseOnBack(phase !== 'sending', close);

  // Foco no título ao abrir e ao trocar para o "Obrigado"
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [phase === 'thanks']);

  async function rate(rating: number) {
    if (phase !== 'ask') return;
    setPhase('sending');
    // sem rede, fica guardada e vai depois: para a pessoa, já foi
    await sendFeedback(rating, text).catch(() => 'queued');
    markFeedbackAnswered();
    setPhase('thanks');
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && phase !== 'sending') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab' || !boxRef.current) return;
    const items = [...boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === titleRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="dialog-overlay feedback-overlay animate__animated animate__fadeIn animate__faster"
      onClick={() => phase !== 'sending' && close()}
    >
      <div
        ref={boxRef}
        className="dialog-box feedback-box animate__animated animate__zoomIn animate__faster"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-sub`}
        onClick={e => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {phase === 'thanks' ? (
          <>
            <div className="dialog-icon"><Icon name="check_circle" filled size="32px" /></div>
            <h2 className="dialog-title" id={`${id}-title`} ref={titleRef} tabIndex={-1}>{t('feedback.thanksTitle')}</h2>
            <p className="dialog-message" id={`${id}-sub`} role="status">{t('feedback.thanksSub')}</p>
            <div className="dialog-actions">
              <button className="btn btn-primary" onClick={onDone}>{t('feedback.close')}</button>
            </div>
          </>
        ) : (
          <>
            <div className="dialog-icon"><Icon name="rate_review" size="32px" /></div>
            <h2 className="dialog-title" id={`${id}-title`} ref={titleRef} tabIndex={-1}>{t('feedback.title')}</h2>
            <p className="dialog-message" id={`${id}-sub`}>{t('feedback.sub')}</p>

            <label className="feedback-label" htmlFor={`${id}-text`}>{t('feedback.textLabel')}</label>
            <textarea
              id={`${id}-text`}
              className="feedback-text"
              value={text}
              maxLength={FEEDBACK_TEXT_MAX}
              rows={3}
              onChange={e => setText(e.target.value.slice(0, FEEDBACK_TEXT_MAX))}
              placeholder={t('feedback.textPlaceholder')}
              aria-describedby={`${id}-privacy ${id}-count`}
              disabled={phase === 'sending'}
            />
            <div className="feedback-meta">
              <p className="feedback-privacy" id={`${id}-privacy`}>
                <Icon name="shield" /> <span>{t('feedback.privacy')}</span>
              </p>
              <span className="feedback-count" id={`${id}-count`}>
                {t('feedback.count', { n: text.length, max: FEEDBACK_TEXT_MAX })}
              </span>
            </div>

            <div className="feedback-stars" role="group" aria-labelledby={`${id}-stars`} onMouseLeave={() => setHover(0)}>
              <p className="feedback-stars-label" id={`${id}-stars`}>{t('feedback.starsLabel')}</p>
              <div className="feedback-stars-row">
                {STARS.map(n => (
                  <button
                    key={n}
                    type="button"
                    className={`feedback-star${n <= hover ? ' feedback-star--on' : ''}`}
                    aria-label={t('feedback.starAria', { n })}
                    onMouseEnter={() => setHover(n)}
                    onFocus={() => setHover(n)}
                    onBlur={() => setHover(0)}
                    onClick={() => void rate(n)}
                    disabled={phase === 'sending'}
                  >
                    <Icon name="star" filled={n <= hover} size="36px" />
                  </button>
                ))}
              </div>
            </div>

            <div className="dialog-actions">
              <button className="btn btn-ghost" onClick={onDismiss} disabled={phase === 'sending'}>
                {t('feedback.later')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
