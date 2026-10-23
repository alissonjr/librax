import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseMc4 } from '../components/ExerciseMc4';
import type { Sign } from '../lib/content';

const sign: Sign = {
  id: 'letra-A',
  gloss: 'A',
  category: 'alfabeto',
  recognition: 'static',
  params: { CM: 'punho fechado', PA: 'espaco neutro', MOV: 'nenhum', OR: 'palma para frente', ENM: 'neutra' },
  video_url: null,
  video_caption: 'Mao direita em punho com polegar apoiado ao lado.',
};

const choices = ['A', 'B', 'C', 'D'];

describe('ExerciseMc4', () => {
  it('renderiza a descricao legivel do sinal (video_caption)', () => {
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/polegar apoiado/i)).toBeInTheDocument();
  });

  it('renderiza 4 opcoes de resposta', () => {
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={vi.fn()} />);
    const choiceButtons = screen.getAllByRole('button').filter(b => choices.includes(b.textContent ?? ''));
    expect(choiceButtons).toHaveLength(4);
  });

  it('chama onAnswer(true) ao selecionar a opcao correta', async () => {
    const onAnswer = vi.fn();
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={onAnswer} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('chama onAnswer(false) ao selecionar opcao errada', async () => {
    const onAnswer = vi.fn();
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={onAnswer} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('desabilita opcoes apos resposta', async () => {
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    screen.getAllByRole('button')
      .filter(b => choices.includes(b.textContent ?? ''))
      .forEach(btn => expect(btn).toBeDisabled());
  });

  it('mostra feedback correto apos resposta correta', async () => {
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(screen.getByText(/correto/i)).toBeInTheDocument();
  });

  it('mostra feedback incorreto e revela resposta correta apos erro', async () => {
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByText(/era A/i)).toBeInTheDocument();
  });

  it('chama onNext ao clicar em Continuar apos resposta', async () => {
    const onNext = vi.fn();
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={onNext} />);
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onNext).toHaveBeenCalled();
  });
});
