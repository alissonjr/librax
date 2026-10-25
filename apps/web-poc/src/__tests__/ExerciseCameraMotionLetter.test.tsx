import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseCameraMotionLetter } from '../components/ExerciseCameraMotionLetter';
import type { Sign } from '../lib/content';
import type { UseLetterMotionCameraReturn } from '../hooks/useLetterMotionCamera';

const mockStart = vi.fn();
const mockStop = vi.fn();

const base: UseLetterMotionCameraReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  status: 'active',
  handPresent: true,
  letter: null,
  targetProbability: 0,
  start: mockStart,
  stop: mockStop,
};

vi.mock('../hooks/useLetterMotionCamera', () => ({
  useLetterMotionCamera: vi.fn(() => base),
}));

import { useLetterMotionCamera } from '../hooks/useLetterMotionCamera';

const J: Sign = {
  id: 'letra-J',
  gloss: 'J',
  category: 'alfabeto',
  recognition: 'dynamic',
  params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
  video_url: null,
  video_caption: 'Mínimo estendido traça a forma da letra J no ar',
};

function withReading(patch: Partial<UseLetterMotionCameraReturn>) {
  vi.mocked(useLetterMotionCamera).mockReturnValue({ ...base, ...patch });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLetterMotionCamera).mockReturnValue(base);
});

describe('ExerciseCameraMotionLetter', () => {
  it('mostra a letra, pede o movimento, liga a câmera ao montar e pede o reconhecedor da letra', () => {
    render(<ExerciseCameraMotionLetter sign={J} onComplete={vi.fn()} />);
    expect(screen.getByText('J')).toBeInTheDocument();
    expect(screen.getByText('Faça a letra com o movimento:')).toBeInTheDocument();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(useLetterMotionCamera).toHaveBeenCalledWith('J');
  });

  it('sem mão no quadro pede a mão; com a mão, avisa que está vendo o movimento', () => {
    withReading({ handPresent: false });
    const { rerender } = render(<ExerciseCameraMotionLetter sign={J} onComplete={vi.fn()} />);
    expect(screen.getByText(/mostre a mão/i)).toBeInTheDocument();
    withReading({ handPresent: true });
    rerender(<ExerciseCameraMotionLetter sign={J} onComplete={vi.fn()} />);
    expect(screen.getByText(/vendo o movimento/i)).toBeInTheDocument();
  });

  it('outra letra lida vira dica, sem dar a resposta como certa', () => {
    withReading({ letter: 'Z' });
    render(<ExerciseCameraMotionLetter sign={J} onComplete={vi.fn()} />);
    expect(screen.getByText(/vimos Z/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a letra do exercício lida (duas avaliações seguidas, no hook) conta como acerto', async () => {
    withReading({ letter: 'J', targetProbability: 0.9 });
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionLetter sign={J} onComplete={onComplete} />);
    expect(screen.getByRole('dialog', { name: /correto/i })).toBeInTheDocument();
    expect(screen.getByText(/você fez a letra J/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /próxima letra/i }));
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('modelo que não carregou: prática sem nota com continuar', async () => {
    withReading({ status: 'unavailable' });
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionLetter sign={J} onComplete={onComplete} />);
    expect(screen.getByText(/não carregou/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it('"Pular" chama onComplete(false)', async () => {
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionLetter sign={J} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });
});
