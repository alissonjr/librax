import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseCameraMotionSign } from '../components/ExerciseCameraMotionSign';
import type { Sign } from '../lib/content';
import type { UseSignCameraRecognizerReturn } from '../hooks/useSignCameraRecognizer';

const mockStart = vi.fn();
const mockStop = vi.fn();

const base: UseSignCameraRecognizerReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  status: 'active',
  handPresent: true,
  bodyPresent: true,
  gloss: null,
  targetProbability: 0,
  start: mockStart,
  stop: mockStop,
};

vi.mock('../hooks/useSignCameraRecognizer', () => ({
  useSignCameraRecognizer: vi.fn(() => base),
}));

import { useSignCameraRecognizer } from '../hooks/useSignCameraRecognizer';

const MESA: Sign = {
  id: 'sinal-MESA',
  gloss: 'MESA',
  category: 'lugares',
  recognition: 'dynamic',
  params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
  video_url: null,
  video_caption: 'As duas mãos desenham o tampo da mesa',
};

function withReading(patch: Partial<UseSignCameraRecognizerReturn>) {
  vi.mocked(useSignCameraRecognizer).mockReturnValue({ ...base, ...patch });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useSignCameraRecognizer).mockReturnValue(base);
});

describe('ExerciseCameraMotionSign', () => {
  it('mostra a glosa, liga a câmera ao montar e pede o reconhecedor da glosa', () => {
    render(<ExerciseCameraMotionSign sign={MESA} onComplete={vi.fn()} />);
    expect(screen.getByText('MESA')).toBeInTheDocument();
    expect(screen.getByText('Faça o sinal:')).toBeInTheDocument();
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(useSignCameraRecognizer).toHaveBeenCalledWith('MESA');
  });

  it('sem corpo no quadro pede rosto e ombros; sem mão, pede as mãos', () => {
    withReading({ bodyPresent: false, handPresent: false });
    const { rerender } = render(<ExerciseCameraMotionSign sign={MESA} onComplete={vi.fn()} />);
    expect(screen.getByText(/rosto e os ombros/i)).toBeInTheDocument();
    withReading({ handPresent: false });
    rerender(<ExerciseCameraMotionSign sign={MESA} onComplete={vi.fn()} />);
    expect(screen.getByText(/levante as mãos/i)).toBeInTheDocument();
  });

  it('outro sinal lido vira dica, sem dar a resposta como certa', () => {
    withReading({ gloss: 'ARROZ' });
    render(<ExerciseCameraMotionSign sign={MESA} onComplete={vi.fn()} />);
    expect(screen.getByText(/vimos ARROZ/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a glosa do exercício lida conta como acerto', async () => {
    withReading({ gloss: 'MESA', targetProbability: 0.9 });
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionSign sign={MESA} onComplete={onComplete} />);
    expect(screen.getByRole('dialog', { name: /correto/i })).toBeInTheDocument();
    expect(screen.getByText(/você fez o sinal MESA/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('modelo que não carregou: prática sem nota com continuar', async () => {
    withReading({ status: 'unavailable' });
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionSign sign={MESA} onComplete={onComplete} />);
    expect(screen.getByText(/não carregou/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it('"Pular" chama onComplete(false)', async () => {
    const onComplete = vi.fn();
    render(<ExerciseCameraMotionSign sign={MESA} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });
});
