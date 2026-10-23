import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SPELL_START, needsRelease, spellStep, type SpellState } from '../lib/fingerspell';
import type { UseCameraRecognizerReturn } from '../hooks/useCameraRecognizer';

const mockStart = vi.fn();
const mockStop = vi.fn();

const base: UseCameraRecognizerReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  landmarksRef: { current: null },
  status: 'active',
  rawGesture: null,
  stableGesture: null,
  handPresent: true,
  confidence: 0.9,
  extensions: null,
  start: mockStart,
  stop: mockStop,
};

vi.mock('../hooks/useCameraRecognizer', () => ({
  useCameraRecognizer: vi.fn(() => base),
}));

import { useCameraRecognizer } from '../hooks/useCameraRecognizer';
import { ExerciseFingerspell } from '../components/ExerciseFingerspell';

/** Passa uma sequência de leituras estáveis pela regra da soletração. */
function run(letters: string[], readings: (string | null)[], minConfidence: number | null = null, confidence = 1) {
  return readings.reduce<SpellState>((s, g) => spellStep(letters, s, g, confidence, minConfidence), SPELL_START);
}

describe('spellStep (regra da soletração)', () => {
  const OSSO = ['O', 'S', 'S', 'O'];

  it('confirma letra a letra na ordem', () => {
    expect(run(['B', 'I', 'A'], ['B', 'I', 'A']).index).toBe(3);
  });

  it('letra errada não reinicia a palavra: a letra da vez continua esperando', () => {
    expect(run(['B', 'I', 'A'], ['B', 'L', 'D', 'I']).index).toBe(2);
  });

  it('SS de OSSO: a mesma letra seguida não conta duas vezes com a mão parada', () => {
    const s = run(OSSO, ['O', 'S']);
    expect(s.index).toBe(2);
    expect(needsRelease(OSSO, s)).toBe(true);
    // a leitura estável continua S: não avança
    expect(spellStep(OSSO, s, 'S')).toBe(s);
  });

  it('SS de OSSO: aceita o segundo S depois que a mão sai do quadro', () => {
    expect(run(OSSO, ['O', 'S', null, 'S', 'O']).index).toBe(4);
  });

  it('SS de OSSO: aceita o segundo S depois que a mão muda de forma', () => {
    expect(run(OSSO, ['O', 'S', 'A', 'S', 'O']).index).toBe(4);
  });

  it('letra diferente da anterior é aceita direto, sem tirar a mão', () => {
    const s = run(['B', 'I'], ['B', 'I']);
    expect(s.index).toBe(2);
  });

  it('respeita a confiança mínima por letra quando definida', () => {
    expect(run(['A'], ['A'], 0.8, 0.5).index).toBe(0);
    expect(run(['A'], ['A'], 0.8, 0.9).index).toBe(1);
  });

  it('palavra completa não muda mais', () => {
    const done = run(['A'], ['A']);
    expect(spellStep(['A'], done, null)).toBe(done);
  });
});

describe('ExerciseFingerspell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCameraRecognizer).mockReturnValue(base);
  });

  it('mostra a palavra, a faixa de letras e a letra da vez, e liga a câmera', () => {
    render(<ExerciseFingerspell word="BIA" letters={['B', 'I', 'A']} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Soletre: BIA' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Letras feitas: 0 de 3' })).toBeInTheDocument();
    expect(screen.getByText('Letra 1 de 3: B')).toBeInTheDocument();
    expect(mockStart).toHaveBeenCalled();
  });

  it('avança conforme a câmera confirma cada letra e conclui a palavra', () => {
    const onAnswer = vi.fn();
    const onNext = vi.fn();
    const view = render(<ExerciseFingerspell word="BIA" letters={['B', 'I', 'A']} onAnswer={onAnswer} onNext={onNext} />);
    for (const g of ['B', 'I', 'A']) {
      vi.mocked(useCameraRecognizer).mockReturnValue({ ...base, stableGesture: g });
      view.rerender(<ExerciseFingerspell word="BIA" letters={['B', 'I', 'A']} onAnswer={onAnswer} onNext={onNext} />);
    }
    expect(screen.getByText('Palavra soletrada!')).toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('letra repetida: pede para tirar a mão ou mudar de forma antes de aceitar de novo', () => {
    const letters = ['A', 'A'];
    const view = render(<ExerciseFingerspell word="AA" letters={letters} onAnswer={vi.fn()} onNext={vi.fn()} />);
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...base, stableGesture: 'A' });
    view.rerender(<ExerciseFingerspell word="AA" letters={letters} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('Letra 2 de 2: A')).toBeInTheDocument();
    expect(screen.getByText(/Tire a mão ou mude de forma/)).toBeInTheDocument();
    // a mão sai e volta com A
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...base, stableGesture: null, handPresent: false });
    view.rerender(<ExerciseFingerspell word="AA" letters={letters} onAnswer={vi.fn()} onNext={vi.fn()} />);
    vi.mocked(useCameraRecognizer).mockReturnValue({ ...base, stableGesture: 'A' });
    view.rerender(<ExerciseFingerspell word="AA" letters={letters} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('Palavra soletrada!')).toBeInTheDocument();
  });

  it('palavra com letra que o classificador não avalia vira order_sequence, sem câmera', () => {
    render(<ExerciseFingerspell word="OSSO" letters={['O', 'S', 'S', 'O']} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/Soletre OSSO: coloque as letras na ordem/)).toBeInTheDocument();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('"Pular" conta como erro e avança', async () => {
    const onAnswer = vi.fn();
    const onNext = vi.fn();
    render(<ExerciseFingerspell word="BIA" letters={['B', 'I', 'A']} onAnswer={onAnswer} onNext={onNext} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pular este exercício' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(onNext).toHaveBeenCalled();
  });
});
