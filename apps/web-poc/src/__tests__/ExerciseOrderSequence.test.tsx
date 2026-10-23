import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseOrderSequence } from '../components/ExerciseOrderSequence';

// order_sequence (spec-03 11.6): arrastar com Pointer Events (dedo e mouse no mesmo código) e
// botões Subir e Descer em cada item, com a nova posição anunciada por aria-live.

// jsdom não tem PointerEvent: sem ele o fireEvent perde clientY e pointerType
class FakePointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}

const ITEM_H = 56;
const GAP = 8;
const originalRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  vi.stubGlobal('PointerEvent', FakePointerEvent);
  // Cada item ocupa uma faixa de 56 px com 8 px de espaço, na ordem em que está na lista
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('order-item')) {
      const i = [...(this.parentElement?.children ?? [])].indexOf(this);
      const top = i * (ITEM_H + GAP);
      return { top, bottom: top + ITEM_H, height: ITEM_H, left: 0, right: 300, width: 300, x: 0, y: top, toJSON() {} } as DOMRect;
    }
    return originalRect.call(this);
  };
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});

afterAll(() => {
  vi.unstubAllGlobals();
  Element.prototype.getBoundingClientRect = originalRect;
});

const STEPS = ['L', 'I', 'A'];
const order = () => screen.getAllByRole('listitem').map((li) => li.querySelector('.order-text')?.textContent);

function setup(props: Partial<Parameters<typeof ExerciseOrderSequence>[0]> = {}) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  // Embaralhamento fixo: com Math.random 0 o Fisher-Yates dá [1, 2, 0] = I, A, L
  const spy = vi.spyOn(Math, 'random').mockReturnValue(0);
  render(<ExerciseOrderSequence steps={STEPS} correctOrder={[0, 1, 2]} onAnswer={onAnswer} onNext={onNext} {...props} />);
  spy.mockRestore();
  return { onAnswer, onNext };
}

describe('ExerciseOrderSequence', () => {
  it('nunca começa já na ordem certa', () => {
    setup();
    expect(order()).not.toEqual(STEPS);
  });

  it('cada item tem Subir e Descer com aria-label; nas pontas o botão sem efeito fica desabilitado', () => {
    setup();
    const [first, , last] = screen.getAllByRole('listitem');
    const firstText = first.querySelector('.order-text')!.textContent!;
    const lastText = last.querySelector('.order-text')!.textContent!;
    expect(within(first).getByRole('button', { name: `Subir ${firstText}` })).toBeDisabled();
    expect(within(first).getByRole('button', { name: `Descer ${firstText}` })).toBeEnabled();
    expect(within(last).getByRole('button', { name: `Descer ${lastText}` })).toBeDisabled();
  });

  it('"Confirmar ordem" habilita assim que a pessoa mexe em um item', async () => {
    setup();
    const confirm = screen.getByRole('button', { name: /confirmar ordem/i });
    expect(confirm).toBeDisabled();
    const [first] = order();
    await userEvent.click(screen.getByRole('button', { name: `Descer ${first}` }));
    expect(confirm).toBeEnabled();
  });

  it('Descer e Subir trocam a posição e anunciam a nova posição', async () => {
    setup();
    const before = order();
    await userEvent.click(screen.getByRole('button', { name: `Descer ${before[0]}` }));
    expect(order()).toEqual([before[1], before[0], before[2]]);
    expect(screen.getByRole('status')).toHaveTextContent(`${before[0]}: posição 2 de 3`);

    await userEvent.click(screen.getByRole('button', { name: `Subir ${before[2]}` }));
    expect(order()).toEqual([before[1], before[2], before[0]]);
    expect(screen.getByRole('status')).toHaveTextContent(`${before[2]}: posição 2 de 3`);
  });

  it('o foco continua no botão do item movido', async () => {
    setup();
    const [first] = order();
    await userEvent.click(screen.getByRole('button', { name: `Descer ${first}` }));
    expect(screen.getByRole('button', { name: `Descer ${first}` })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: `Descer ${first}` }));
    // chegou ao fim: Descer desabilita e o foco vai para Subir do mesmo item
    expect(screen.getByRole('button', { name: `Subir ${first}` })).toHaveFocus();
  });

  it('só com os botões chega na ordem certa e confirma', async () => {
    const { onAnswer } = setup();
    // I, A, L -> L, I, A
    await userEvent.click(screen.getByRole('button', { name: 'Subir L' }));
    await userEvent.click(screen.getByRole('button', { name: 'Subir L' }));
    expect(order()).toEqual(STEPS);
    await userEvent.click(screen.getByRole('button', { name: /confirmar ordem/i }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('arrastar com o dedo (pointerType touch) reordena e anuncia ao soltar', () => {
    setup();
    expect(order()).toEqual(['I', 'A', 'L']);
    const item = screen.getAllByRole('listitem')[0];

    fireEvent.pointerDown(item, { pointerId: 7, pointerType: 'touch', clientY: 20, button: 0 });
    expect(item).toHaveClass('order-item--dragging');
    // desce dois itens (2 x 64 px)
    fireEvent.pointerMove(item, { pointerId: 7, pointerType: 'touch', clientY: 20 + 2 * (ITEM_H + GAP) });
    expect(order()).toEqual(['A', 'L', 'I']);
    fireEvent.pointerUp(item, { pointerId: 7, pointerType: 'touch', clientY: 20 + 2 * (ITEM_H + GAP) });

    expect(screen.getAllByRole('listitem')[2]).not.toHaveClass('order-item--dragging');
    expect(screen.getByRole('status')).toHaveTextContent('I: posição 3 de 3');
    expect(screen.getByRole('button', { name: /confirmar ordem/i })).toBeEnabled();
  });

  it('arrasto cancelado pelo navegador (pointercancel) solta o item onde está', () => {
    setup();
    const item = screen.getAllByRole('listitem')[0];
    fireEvent.pointerDown(item, { pointerId: 3, pointerType: 'touch', clientY: 10, button: 0 });
    fireEvent.pointerMove(item, { pointerId: 3, pointerType: 'touch', clientY: 10 + ITEM_H + GAP });
    fireEvent.pointerCancel(item, { pointerId: 3, pointerType: 'touch' });
    expect(order()).toEqual(['A', 'I', 'L']);
    expect(document.querySelector('.order-item--dragging')).toBeNull();
  });

  it('toque nos botões não começa arrasto', () => {
    setup();
    const btn = screen.getByRole('button', { name: 'Descer I' });
    fireEvent.pointerDown(btn, { pointerId: 2, pointerType: 'touch', clientY: 20, button: 0 });
    expect(document.querySelector('.order-item--dragging')).toBeNull();
  });

  it('ordem errada marca os itens fora do lugar e mostra a ordem certa', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Descer I' })); // A, I, L (certa: L, I, A)
    await userEvent.click(screen.getByRole('button', { name: /confirmar ordem/i }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(document.querySelectorAll('.order-item--wrong')).toHaveLength(2);
    expect(document.querySelectorAll('.order-item--correct')).toHaveLength(1);
    expect(screen.getByText('Ordem correta:')).toBeInTheDocument();
  });

  it('usa o enunciado recebido (soletração) e o padrão sem ele', () => {
    setup({ prompt: 'Soletre LIA: coloque as letras na ordem' });
    expect(screen.getByRole('heading', { name: 'Soletre LIA: coloque as letras na ordem' })).toBeInTheDocument();
  });

  it('sem prompt mostra o enunciado padrão', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Ordene os passos do sinal:' })).toBeInTheDocument();
  });
});
