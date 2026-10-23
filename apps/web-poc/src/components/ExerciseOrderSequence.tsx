import { useState, useRef, useLayoutEffect } from 'react';
import { useT } from '../i18n';
import { shuffle } from '../lib/content';
import { Haptics } from '../lib/haptics';
import { Sfx } from '../lib/sound';
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

/** Arrasto em andamento: o item, o dedo (ou mouse) e os centros das posicoes no inicio. */
interface Drag {
  pointerId: number;
  stepIdx: number;
  from: number;
  startY: number;
  centers: number[];
}

/** Embaralha sem comecar ja na ordem certa (com 2 ou mais passos). */
function initialOrder(steps: string[], correctOrder: number[]): number[] {
  const keys = [...steps.keys()];
  let order = shuffle(keys);
  for (let i = 0; i < 5 && keys.length > 1 && order.every((s, j) => s === correctOrder[j]); i++) {
    order = shuffle(keys);
  }
  if (keys.length > 1 && order.every((s, j) => s === correctOrder[j])) order = [...order.slice(1), order[0]];
  return order;
}

/** Posicao mais perto de `y` entre os centros das posicoes. */
function nearest(centers: number[], y: number): number {
  let best = 0;
  centers.forEach((c, i) => { if (Math.abs(c - y) < Math.abs(centers[best] - y)) best = i; });
  return best;
}

function moveTo(order: number[], from: number, to: number): number[] {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * "Ordene os passos" (spec-03 11.6). Cada cartão arrasta com Pointer Events, um código só para
 * dedo e mouse: o cartão tem `touch-action: none`, então a página não rola junto no Safari do
 * iPhone nem no Chrome do Android, e o ponteiro fica capturado no cartão até soltar. Os botões
 * Subir e Descer (48 px) fazem o mesmo sem arrastar, com teclado e leitor de tela; a nova
 * posição é anunciada numa região aria-live.
 */
export function ExerciseOrderSequence({ steps, correctOrder, prompt, onAnswer, onNext }: Props) {
  const { t } = useT();
  const [order, setOrder] = useState<number[]>(() => initialOrder(steps, correctOrder));
  const [touched, setTouched] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [dragging, setDragging] = useState<{ stepIdx: number; offset: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Botão a focar depois de mover pelo teclado: o React move o nó na lista e o foco se perde
  const refocus = useRef<{ stepIdx: number; dir: 'up' | 'down' } | null>(null);

  useLayoutEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const find = (dir: 'up' | 'down') =>
      listRef.current?.querySelector<HTMLButtonElement>(`button[data-step="${target.stepIdx}"][data-dir="${dir}"]`);
    const btn = find(target.dir);
    (btn && !btn.disabled ? btn : find(target.dir === 'up' ? 'down' : 'up'))?.focus();
  }, [order]);

  function announce(next: number[], stepIdx: number) {
    setAnnouncement(t('exerciseOrderSequence.moved', {
      step: steps[stepIdx], position: next.indexOf(stepIdx) + 1, total: next.length,
    }));
  }

  function moveBy(position: number, delta: -1 | 1) {
    const to = position + delta;
    if (answered || to < 0 || to >= order.length) return;
    const stepIdx = order[position];
    const next = moveTo(order, position, to);
    refocus.current = { stepIdx, dir: delta < 0 ? 'up' : 'down' };
    setTouched(true);
    setOrder(next);
    announce(next, stepIdx);
  }

  function onPointerDown(e: React.PointerEvent<HTMLLIElement>, position: number) {
    if (answered || drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('button')) return; // Subir e Descer não arrastam
    const items = [...(listRef.current?.children ?? [])] as HTMLElement[];
    const centers = items.map(el => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { pointerId: e.pointerId, stepIdx: order[position], from: position, startY: e.clientY, centers };
    setTouched(true);
    setDragging({ stepIdx: order[position], offset: 0 });
  }

  function onPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    e.preventDefault();
    const dy = e.clientY - d.startY;
    const to = nearest(d.centers, d.centers[d.from] + dy);
    const current = order.indexOf(d.stepIdx);
    if (to !== current) {
      setOrder(moveTo(order, current, to));
      Haptics.select();
    }
    // O cartão já está na posição `to`: o deslocamento compensa para ele seguir o dedo
    setDragging({ stepIdx: d.stepIdx, offset: dy - (d.centers[to] - d.centers[d.from]) });
  }

  function endDrag(e: React.PointerEvent<HTMLLIElement>) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    setDragging(null);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (order.indexOf(d.stepIdx) !== d.from) announce(order, d.stepIdx);
  }

  function handleConfirm() {
    const correct = order.every((step, i) => step === correctOrder[i]);
    setAnswered(true);
    setIsCorrect(correct);
    if (correct) { Haptics.correct(); Sfx.correct(); } else Sfx.neutral();
    onAnswer(correct);
    if (correct) setTimeout(onNext, 1000);
  }

  return (
    <div className="exercise-screen">
      <h2 className="exercise-prompt">{prompt ?? t('exerciseOrderSequence.prompt')}</h2>
      {!answered && <p className="order-hint">{t('exerciseOrderSequence.hint')}</p>}

      <ol className="order-list" ref={listRef}>
        {order.map((stepIdx, position) => {
          const step = steps[stepIdx];
          const isDragging = dragging?.stepIdx === stepIdx;
          let cls = 'order-item';
          if (answered) {
            cls += stepIdx === correctOrder[position] ? ' order-item--correct' : ' order-item--wrong';
          }
          if (isDragging) cls += ' order-item--dragging';
          return (
            <li
              key={stepIdx}
              className={cls}
              style={isDragging ? { transform: `translateY(${dragging.offset}px)` } : undefined}
              onPointerDown={e => onPointerDown(e, position)}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <Icon name="drag_indicator" className="order-grip" />
              <span className="order-text">{step}</span>
              {answered ? (
                stepIdx === correctOrder[position]
                  ? <Icon name="check" className="order-status-icon order-status-icon--ok" />
                  : <Icon name="close" className="order-status-icon order-status-icon--err" />
              ) : (
                <span className="order-moves">
                  <button
                    type="button"
                    className="order-move"
                    data-step={stepIdx}
                    data-dir="up"
                    aria-label={t('exerciseOrderSequence.moveUp', { step })}
                    disabled={position === 0}
                    onClick={() => moveBy(position, -1)}
                  >
                    <Icon name="arrow_upward" />
                  </button>
                  <button
                    type="button"
                    className="order-move"
                    data-step={stepIdx}
                    data-dir="down"
                    aria-label={t('exerciseOrderSequence.moveDown', { step })}
                    disabled={position === order.length - 1}
                    onClick={() => moveBy(position, 1)}
                  >
                    <Icon name="arrow_downward" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>

      {!answered && (
        <button className="btn btn-primary" onClick={handleConfirm} disabled={!touched}>
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
