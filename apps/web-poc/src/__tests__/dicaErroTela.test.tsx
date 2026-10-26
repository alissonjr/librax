import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WrongReadingHint } from '../dicaErro/WrongReadingHint';
import { setWebglAvailableForTests } from '../mao3d/disponivel';
import { ExerciseCameraSign } from '../components/ExerciseCameraSign';
import { ExerciseCameraMotionLetter } from '../components/ExerciseCameraMotionLetter';
import type { Sign } from '../lib/content';

// As mãos em 3D (pedaço sob demanda): um substituto que mostra o que recebeu
vi.mock('../dicaErro/MaosComparadas', () => ({
  default: (p: { highlight: string[]; moving: string | null; onError: () => void }) => (
    <div data-testid="maos" data-highlight={p.highlight.join(',')} data-moving={p.moving ?? ''}>
      <button type="button" onClick={p.onError}>falhar</button>
    </div>
  ),
}));

const camera = {
  videoRef: { current: null },
  canvasRef: { current: null },
  landmarksRef: { current: null },
  status: 'active' as const,
  rawGesture: null,
  stableGesture: null as string | null,
  handPresent: true,
  confidence: 0.5,
  extensions: null,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock('../hooks/useCameraRecognizer', () => ({ useCameraRecognizer: vi.fn(() => camera) }));
const motion = {
  videoRef: { current: null },
  canvasRef: { current: null },
  status: 'active' as const,
  handPresent: true,
  letter: null as string | null,
  targetProbability: 0,
  start: vi.fn(),
  stop: vi.fn(),
};
vi.mock('../hooks/useLetterMotionCamera', () => ({ useLetterMotionCamera: vi.fn(() => motion) }));
import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { useLetterMotionCamera } from '../hooks/useLetterMotionCamera';

function letter(gloss: string, recognition = 'static'): Sign {
  return {
    id: `letra-${gloss}`, gloss, category: 'alfabeto', recognition,
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' }, video_url: null, video_caption: `Letra ${gloss}`,
  };
}

beforeEach(() => { setWebglAvailableForTests(false); });
afterEach(() => { setWebglAvailableForTests(null); vi.clearAllMocks(); });

describe('WrongReadingHint', () => {
  it('sem WebGL: a dica só em texto, com as duas letras, a diferença e o anúncio para o leitor de tela', async () => {
    const onDismiss = vi.fn();
    render(<WrongReadingHint asked="U" read="V" kind="letter" onDismiss={onDismiss} />);
    expect(screen.getByRole('heading', { name: 'A câmera viu V' })).toBeInTheDocument();
    expect(screen.getByText('Você precisa fazer')).toBeInTheDocument();
    expect(screen.getByText('U')).toBeInTheDocument();
    expect(screen.getByText('Diferença: o indicador e o médio ficam juntos')).toBeInTheDocument();
    expect(screen.queryByTestId('maos')).toBeNull();
    // Região viva: vazia na montagem, preenchida logo depois
    const status = screen.getByRole('status');
    await waitFor(() => expect(status).toHaveTextContent('A câmera viu o V. Você precisa fazer o U: o indicador e o médio ficam juntos.'));
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    await userEvent.click(screen.getByRole('button', { name: /fechar a dica/i }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('par sem dados: pede para comparar as duas mãos', () => {
    render(<WrongReadingHint asked="A" read="Y" kind="letter" onDismiss={vi.fn()} />);
    expect(screen.getByText('Compare as duas mãos.')).toBeInTheDocument();
  });

  it('número: o artigo e a diferença do número', () => {
    render(<WrongReadingHint asked="4" read="2" kind="number" onDismiss={vi.fn()} />);
    expect(screen.getByText('Diferença: o médio, o anelar e o mínimo ficam esticados')).toBeInTheDocument();
  });

  it('com WebGL: as mãos recebem os dedos a destacar e qual mão toca o movimento', async () => {
    setWebglAvailableForTests(true);
    const { unmount } = render(<WrongReadingHint asked="U" read="V" kind="letter" onDismiss={vi.fn()} />);
    expect(await screen.findByTestId('maos')).toHaveAttribute('data-highlight', 'index,middle');
    expect(screen.getByTestId('maos')).toHaveAttribute('data-moving', '');
    unmount();
    const k = render(<WrongReadingHint asked="K" read="H" kind="letter" onDismiss={vi.fn()} />);
    expect(await screen.findByTestId('maos')).toHaveAttribute('data-moving', 'asked');
    k.unmount();
    render(<WrongReadingHint asked="C" read="Ç" kind="letter" onDismiss={vi.fn()} />);
    expect(await screen.findByTestId('maos')).toHaveAttribute('data-moving', 'read');
    expect(screen.getByText('Diferença: o C fica parado, sem movimento')).toBeInTheDocument();
  });

  it('o 3D falhou: fica a dica em texto', async () => {
    setWebglAvailableForTests(true);
    render(<WrongReadingHint asked="U" read="V" kind="letter" onDismiss={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'falhar' }));
    expect(screen.queryByTestId('maos')).toBeNull();
    expect(screen.getByText('Diferença: o indicador e o médio ficam juntos')).toBeInTheDocument();
  });
});

describe('dica de erro nos exercícios com câmera', () => {
  it('letra parada: duas leituras estáveis da letra errada abrem a dica no lugar do alvo; Entendi volta o alvo', async () => {
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...camera, stableGesture: 'V' });
    const { rerender } = render(<ExerciseCameraSign sign={letter('U')} onComplete={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'A câmera viu V' })).toBeNull();
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...camera, stableGesture: null });
    rerender(<ExerciseCameraSign sign={letter('U')} onComplete={vi.fn()} />);
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...camera, stableGesture: 'V' });
    rerender(<ExerciseCameraSign sign={letter('U')} onComplete={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'A câmera viu V' })).toBeInTheDocument();
    expect(screen.queryByText('Faça o sinal:')).toBeNull();
    // A câmera continua: o vídeo segue na tela
    expect(screen.getByLabelText(/câmera/i, { selector: 'video' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByRole('region', { name: 'A câmera viu V' })).toBeNull();
  });

  it('letra com movimento: a leitura confirmada de outra letra abre a dica na hora', () => {
    vi.mocked(useLetterMotionCamera).mockReturnValue({ ...motion, letter: null });
    const { rerender } = render(<ExerciseCameraMotionLetter sign={letter('K')} onComplete={vi.fn()} />);
    vi.mocked(useLetterMotionCamera).mockReturnValue({ ...motion, letter: 'H' });
    rerender(<ExerciseCameraMotionLetter sign={letter('K')} onComplete={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'A câmera viu H' })).toBeInTheDocument();
    expect(screen.getByText('Diferença: o K tem outro movimento')).toBeInTheDocument();
  });

  it('acertou: a dica some', () => {
    vi.mocked(useLetterMotionCamera).mockReturnValue({ ...motion, letter: 'H' });
    const { rerender } = render(<ExerciseCameraMotionLetter sign={letter('K')} onComplete={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'A câmera viu H' })).toBeInTheDocument();
    vi.mocked(useLetterMotionCamera).mockReturnValue({ ...motion, letter: 'K' });
    act(() => { rerender(<ExerciseCameraMotionLetter sign={letter('K')} onComplete={vi.fn()} />); });
    expect(screen.queryByRole('region', { name: 'A câmera viu H' })).toBeNull();
  });
});
