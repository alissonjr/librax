import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseMatchPairs } from '../components/ExerciseMatchPairs';
import type { Sign } from '../lib/content';

const signs: Sign[] = [
  { id: 'letra-A', gloss: 'A', category: 'alfabeto', recognition: 'static',
    params: { CM: 'punho fechado', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null, video_caption: 'Punho fechado.' },
  { id: 'letra-B', gloss: 'B', category: 'alfabeto', recognition: 'static',
    params: { CM: 'dedos estendidos e juntos', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null, video_caption: 'Dedos juntos e estendidos.' },
  { id: 'letra-C', gloss: 'C', category: 'alfabeto', recognition: 'static',
    params: { CM: 'mao curvada em C', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null, video_caption: 'Mao curvada em C.' },
];

describe('ExerciseMatchPairs', () => {
  it('renderiza as descricoes dos sinais como cartoes', () => {
    render(<ExerciseMatchPairs signs={signs} onComplete={vi.fn()} />);
    expect(screen.getByText(/Punho fechado/i)).toBeInTheDocument();
    expect(screen.getByText(/Dedos juntos/i)).toBeInTheDocument();
    expect(screen.getByText(/curvada em C/i)).toBeInTheDocument();
  });

  it('renderiza os botoes de glosa', () => {
    render(<ExerciseMatchPairs signs={signs} onComplete={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'C' })).toBeInTheDocument();
  });

  it('seleciona um cartao ao clicar nele', async () => {
    render(<ExerciseMatchPairs signs={signs} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText(/Punho fechado/i));
    expect(screen.getByText(/Punho fechado/i).closest('[data-selected]')).toBeTruthy();
  });

  it('chama onComplete(true) quando todos os pares sao corretos', async () => {
    const onComplete = vi.fn();
    render(<ExerciseMatchPairs signs={signs} onComplete={onComplete} />);
    // Par A
    await userEvent.click(screen.getByText(/Punho fechado/i));
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
    // Par B
    await userEvent.click(screen.getByText(/Dedos juntos/i));
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    // Par C
    await userEvent.click(screen.getByText(/curvada em C/i));
    await userEvent.click(screen.getByRole('button', { name: 'C' }));

    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('marca par errado e permite nova tentativa sem encerrar', async () => {
    const onComplete = vi.fn();
    render(<ExerciseMatchPairs signs={signs} onComplete={onComplete} />);
    await userEvent.click(screen.getByText(/Punho fechado/i));
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onComplete).not.toHaveBeenCalled();
  });
});
