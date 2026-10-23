import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseCameraSign } from '../components/ExerciseCameraSign';
import type { Sign } from '../lib/content';

const mockStart = vi.fn();
const mockStop = vi.fn();

const defaultHookReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  landmarksRef: { current: null },
  status: 'idle' as const,
  rawGesture: null,
  stableGesture: null,
  handPresent: false,
  confidence: 0,
  extensions: null,
  start: mockStart,
  stop: mockStop,
};

vi.mock('../hooks/useCameraRecognizer', () => ({
  useCameraRecognizer: vi.fn(() => defaultHookReturn),
}));

import { useCameraRecognizer } from '../hooks/useCameraRecognizer';

function makeSign(gloss: string): Sign {
  return {
    id: `letra-${gloss}`,
    gloss,
    category: 'alfabeto',
    recognition: '',
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null,
    video_caption: `Mao direita fazendo sinal ${gloss}`,
  };
}

beforeEach(() => {
  vi.mocked(useCameraRecognizer).mockReturnValue(defaultHookReturn);
  vi.clearAllMocks();
});

describe('ExerciseCameraSign', () => {
  it('mostra a letra alvo para sinal reconhecivel', () => {
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={vi.fn()} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText(/faça o sinal/i)).toBeInTheDocument();
  });

  it('inicia a camera automaticamente para sinal reconhecivel', () => {
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={vi.fn()} />);
    expect(mockStart).toHaveBeenCalled();
  });

  it('nao inicia camera para sinal nao reconhecivel', () => {
    render(<ExerciseCameraSign sign={makeSign('Z')} onComplete={vi.fn()} />);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('mostra mensagem de PoC para sinal nao reconhecivel', () => {
    render(<ExerciseCameraSign sign={makeSign('Z')} onComplete={vi.fn()} />);
    expect(screen.getByText(/reconhecimento automático ainda não disponível/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continuar/i })).toBeInTheDocument();
  });

  it('"Pular" chama onComplete(false)', async () => {
    vi.mocked(useCameraRecognizer).mockReturnValue({
      ...defaultHookReturn,
      status: 'active',
    });
    const onComplete = vi.fn();
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
  });

  it('mostra sucesso e avanca ao clicar em "proxima letra" quando o gesto correto e detectado', async () => {
    vi.mocked(useCameraRecognizer).mockReturnValue({
      ...defaultHookReturn,
      status: 'active',
      stableGesture: 'A',
    });
    const onComplete = vi.fn();
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={onComplete} />);
    // mensagem de sucesso aparece, sem avancar sozinho
    expect(screen.getByText(/você fez a letra a/i)).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /próxima letra/i }));
    expect(onComplete).toHaveBeenCalledWith(true);
  });

  it('nao mostra sucesso quando gesto errado e detectado', () => {
    vi.mocked(useCameraRecognizer).mockReturnValue({
      ...defaultHookReturn,
      status: 'active',
      stableGesture: 'B',
    });
    const onComplete = vi.fn();
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={onComplete} />);
    expect(screen.queryByText(/você fez a letra/i)).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('mostra o caption do sinal', () => {
    render(<ExerciseCameraSign sign={makeSign('A')} onComplete={vi.fn()} />);
    expect(screen.getByText(/Mao direita fazendo sinal A/i)).toBeInTheDocument();
  });
});
