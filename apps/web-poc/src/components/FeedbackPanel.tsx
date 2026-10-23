import type { ReactNode } from 'react';
import { Icon } from './Icon';

export type FeedbackTone = 'correct' | 'wrong' | 'retry';

interface Props {
  tone: FeedbackTone;
  title: string;
  body?: ReactNode;
  /** Conteúdo extra abaixo do corpo (ex.: a ordem correta). */
  children?: ReactNode;
  actionLabel: string;
  onAction: () => void;
}

/**
 * Painel de feedback do exercício (seção 11.6 da proposta de design system).
 * Sobe do rodapé, fica acima da safe area e sempre traz ícone e texto: a cor nunca é a única pista.
 * Erro usa coral e uma dica, nunca vibra nem toca som negativo.
 */
export function FeedbackPanel({ tone, title, body, children, actionLabel, onAction }: Props) {
  return (
    <div
      className={`feedback-bar feedback-bar--${tone} animate__animated animate__slideInUp animate__faster`}
      role="status"
      aria-live="assertive"
    >
      <div className="feedback-head">
        <Icon
          name={tone === 'correct' ? 'check_circle' : 'lightbulb'}
          filled
          size="32px"
          className="feedback-icon"
        />
        <div className="feedback-text">
          <p className="feedback-title">{title}</p>
          {body && <div className="feedback-body">{body}</div>}
          {children}
        </div>
      </div>
      <button className="btn btn-primary feedback-next-btn" onClick={onAction} aria-label={actionLabel}>
        {actionLabel} <Icon name="arrow_forward" />
      </button>
    </div>
  );
}
