import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Sign } from '../lib/content';

// Sem vídeo nem avatar: a demonstração mostra a descrição (fallback)
vi.mock('../components/SignDemo', () => ({
  SignDemo: ({ fallback }: { fallback: ReactNode }) => <>{fallback}</>,
}));

import { ExerciseWatchChooseWord } from '../components/ExerciseWatchChooseWord';

const ESCOLA: Sign = {
  id: 'sinal-ESCOLA',
  gloss: 'ESCOLA',
  category: 'lugares',
  recognition: 'dynamic',
  params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
  video_url: null,
  video_caption: 'Sinal composto: CASA (mãos em telhado) e depois ESTUDAR (dedos batem na palma).',
};

describe('ExerciseWatchChooseWord', () => {
  it('esconde as glosas das outras opções citadas na descrição até responder', async () => {
    render(
      <ExerciseWatchChooseWord sign={ESCOLA} choices={['IGREJA', 'CASA', 'ESCOLA', 'ESTUDAR']} onAnswer={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText('Sinal composto: ___ (mãos em telhado) e depois ___ (dedos batem na palma).')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'IGREJA' }));
    expect(screen.getByText(ESCOLA.video_caption)).toBeInTheDocument();
  });

  it('citação de sinal que não está entre as opções continua visível', () => {
    render(
      <ExerciseWatchChooseWord sign={ESCOLA} choices={['IGREJA', 'HOSPITAL', 'ESCOLA', 'CASA']} onAnswer={vi.fn()} onNext={vi.fn()} />,
    );
    expect(screen.getByText('Sinal composto: ___ (mãos em telhado) e depois ESTUDAR (dedos batem na palma).')).toBeInTheDocument();
  });
});
