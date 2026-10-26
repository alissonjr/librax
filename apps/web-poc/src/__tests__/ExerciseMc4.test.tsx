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
  params: { CM: 'Punho fechado', PA: 'espaço neutro', MOV: 'nenhum', OR: 'palma para frente', ENM: 'neutra' },
  video_url: null,
  video_caption: 'Mão direita em punho com polegar apoiado ao lado.',
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

  it('esconde a glosa de outra opcao citada na descricao ate responder', async () => {
    const pai: Sign = {
      ...sign,
      id: 'sinal-PAI',
      gloss: 'PAI',
      category: 'familia',
      video_caption: 'Segure o queixo e deslize para baixo (HOMEM); depois encoste a mão nos lábios.',
    };
    render(<ExerciseMc4 sign={pai} choices={['MÃE', 'HOMEM', 'PAI', 'TIO']} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('Segure o queixo e deslize para baixo (___); depois encoste a mão nos lábios.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'PAI' }));
    expect(screen.getByText(/\(HOMEM\)/)).toBeInTheDocument();
  });

  it('a nota de movimento tambem esconde a glosa certa e as outras opcoes citadas', () => {
    const pai: Sign = {
      ...sign,
      id: 'sinal-PAI',
      gloss: 'PAI',
      category: 'familia',
      recognition: 'dynamic',
      params: { ...sign.params, MOV: 'desliza para baixo (sinal HOMEM) e depois PAI encosta nos lábios' },
      video_caption: 'Segure o queixo.',
    };
    render(<ExerciseMc4 sign={pai} choices={['MÃE', 'HOMEM', 'PAI', 'TIO']} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/desliza para baixo \(sinal ___\) e depois ___ encosta/)).toBeInTheDocument();
  });

  it('MOV que ja termina com ponto nao fica com ponto duplo na nota de movimento', () => {
    const ir: Sign = {
      ...sign,
      id: 'sinal-IR',
      gloss: 'IR',
      category: 'verbos',
      recognition: 'dynamic',
      params: { ...sign.params, MOV: 'Forma base: o indicador faz um arco para fora. No espaço: vai até o lugar.' },
      video_caption: 'Indicador em arco.',
    };
    render(<ExerciseMc4 sign={ir} choices={['IR', 'VIR', 'DAR', 'VER']} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/vai até o lugar\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/\.\.$/)).not.toBeInTheDocument();
  });

  it('chama onNext ao clicar em Continuar apos resposta', async () => {
    const onNext = vi.fn();
    render(<ExerciseMc4 sign={sign} choices={choices} onAnswer={vi.fn()} onNext={onNext} />);
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onNext).toHaveBeenCalled();
  });
});
