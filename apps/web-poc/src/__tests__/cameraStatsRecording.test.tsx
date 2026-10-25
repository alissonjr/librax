import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Sign } from '../lib/content';
import type { UseCameraRecognizerReturn } from '../hooks/useCameraRecognizer';
import type { UseSignCameraRecognizerReturn } from '../hooks/useSignCameraRecognizer';

/**
 * O que os exercícios de câmera mandam para o desempenho da câmera (lib/cameraStats.ts):
 * acerto com as tentativas, pulo e leituras de outro sinal. A gravação em si é testada em
 * cameraStats.test.ts; aqui só o que cada exercício entrega.
 */

vi.mock('../lib/cameraStats', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/cameraStats')>()),
  saveCameraRun: vi.fn(),
}));

const letterBase: UseCameraRecognizerReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  landmarksRef: { current: null },
  status: 'active',
  rawGesture: null,
  stableGesture: null,
  handPresent: true,
  confidence: 0.9,
  extensions: null,
  start: vi.fn(),
  stop: vi.fn(),
};

const signBase: UseSignCameraRecognizerReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  status: 'active',
  handPresent: true,
  bodyPresent: true,
  gloss: null,
  targetProbability: 0,
  start: vi.fn(),
  stop: vi.fn(),
};

vi.mock('../lib/confetti', () => ({ launchConfetti: vi.fn() }));
vi.mock('../hooks/useCameraRecognizer', () => ({ useCameraRecognizer: vi.fn() }));
vi.mock('../hooks/useSignCameraRecognizer', () => ({ useSignCameraRecognizer: vi.fn() }));

import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { useSignCameraRecognizer } from '../hooks/useSignCameraRecognizer';
import { saveCameraRun } from '../lib/cameraStats';
import { ExerciseCameraSign } from '../components/ExerciseCameraSign';
import { ExerciseCameraMotionSign } from '../components/ExerciseCameraMotionSign';
import { ExerciseFingerspell } from '../components/ExerciseFingerspell';

function makeSign(id: string, gloss: string): Sign {
  return {
    id,
    gloss,
    category: 'alfabeto',
    recognition: '',
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null,
    video_caption: `Sinal ${gloss}`,
  };
}

function letterReading(patch: Partial<UseCameraRecognizerReturn>) {
  vi.mocked(useCameraRecognizer).mockReturnValue({ ...letterBase, ...patch });
}

function signReading(patch: Partial<UseSignCameraRecognizerReturn>) {
  vi.mocked(useSignCameraRecognizer).mockReturnValue({ ...signBase, ...patch });
}

const saved = () => vi.mocked(saveCameraRun).mock.calls.map(([run]) => run).filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  letterReading({});
  signReading({});
});

describe('letra parada (ExerciseCameraSign)', () => {
  it('acerto depois de duas leituras erradas: 3 tentativas', () => {
    const sign = makeSign('letra-B', 'B');
    const { rerender } = render(<ExerciseCameraSign sign={sign} onComplete={vi.fn()} />);
    for (const g of ['A', null, 'U', 'B']) {
      letterReading({ stableGesture: g });
      rerender(<ExerciseCameraSign sign={sign} onComplete={vi.fn()} />);
    }
    expect(saved()).toEqual([
      { signId: 'letra-B', label: 'B', kind: 'letter', outcome: 'success', wrongReadings: { A: 1, U: 1 } },
    ]);
  });

  it('pular registra o pulo com o que a câmera leu', async () => {
    const sign = makeSign('letra-B', 'B');
    const onComplete = vi.fn();
    const { rerender } = render(<ExerciseCameraSign sign={sign} onComplete={onComplete} />);
    letterReading({ stableGesture: 'V' });
    rerender(<ExerciseCameraSign sign={sign} onComplete={onComplete} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(onComplete).toHaveBeenCalledWith(false);
    expect(saved()).toEqual([
      { signId: 'letra-B', label: 'B', kind: 'letter', outcome: 'skip', wrongReadings: { V: 1 } },
    ]);
  });

  it('pular sem a câmera ter ligado não conta (permissão negada)', async () => {
    letterReading({ status: 'denied', handPresent: false });
    render(<ExerciseCameraSign sign={makeSign('letra-B', 'B')} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(saved()).toEqual([]);
  });

  it('letra que a câmera não avalia não conta', async () => {
    render(<ExerciseCameraSign sign={makeSign('letra-Z', 'Z')} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(saved()).toEqual([]);
  });
});

describe('sinal com movimento (ExerciseCameraMotionSign)', () => {
  it('acerto com uma leitura de outro sinal antes', () => {
    const sign = makeSign('sinal-MESA', 'MESA');
    const { rerender } = render(<ExerciseCameraMotionSign sign={sign} onComplete={vi.fn()} />);
    for (const g of ['CASA', 'MESA']) {
      signReading({ gloss: g });
      rerender(<ExerciseCameraMotionSign sign={sign} onComplete={vi.fn()} />);
    }
    expect(saved()).toEqual([
      { signId: 'sinal-MESA', label: 'MESA', kind: 'sign', outcome: 'success', wrongReadings: { CASA: 1 } },
    ]);
  });

  it('pulo', async () => {
    render(<ExerciseCameraMotionSign sign={makeSign('sinal-MESA', 'MESA')} onComplete={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(saved()).toEqual([
      { signId: 'sinal-MESA', label: 'MESA', kind: 'sign', outcome: 'skip', wrongReadings: {} },
    ]);
  });
});

describe('soletração (ExerciseFingerspell), letra a letra', () => {
  it('cada letra aceita vira um acerto da letra; a letra anterior ainda na mão não é erro', () => {
    const props = { word: 'BIA', letters: ['B', 'I', 'A'], onAnswer: vi.fn(), onNext: vi.fn() };
    const { rerender } = render(<ExerciseFingerspell {...props} />);
    for (const g of ['B', null, 'B', 'L', 'I', 'A']) {
      letterReading({ stableGesture: g });
      rerender(<ExerciseFingerspell {...props} />);
    }
    expect(saved()).toEqual([
      { signId: 'letra-B', label: 'B', kind: 'letter', outcome: 'success', wrongReadings: {} },
      { signId: 'letra-I', label: 'I', kind: 'letter', outcome: 'success', wrongReadings: { L: 1 } },
      { signId: 'letra-A', label: 'A', kind: 'letter', outcome: 'success', wrongReadings: {} },
    ]);
    expect(props.onAnswer).toHaveBeenCalledWith(true);
  });

  it('pular conta o pulo só da letra da vez', async () => {
    const props = { word: 'BIA', letters: ['B', 'I', 'A'], onAnswer: vi.fn(), onNext: vi.fn() };
    const { rerender } = render(<ExerciseFingerspell {...props} />);
    for (const g of ['B', 'D']) {
      letterReading({ stableGesture: g });
      rerender(<ExerciseFingerspell {...props} />);
    }
    await userEvent.click(screen.getByRole('button', { name: /pular/i }));
    expect(saved()).toEqual([
      { signId: 'letra-B', label: 'B', kind: 'letter', outcome: 'success', wrongReadings: {} },
      { signId: 'letra-I', label: 'I', kind: 'letter', outcome: 'skip', wrongReadings: { D: 1 } },
    ]);
  });
});
