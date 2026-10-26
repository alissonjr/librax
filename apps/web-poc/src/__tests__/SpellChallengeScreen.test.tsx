import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { IdbRepo } from '../lib/idbRepo';
import type { MlpModel } from '../recognition/mlp';
import { setLetterMotionModelForTests } from '../recognition/letterMotionModel';

// As palavras viram fingerspell ou order_sequence conforme o aparelho; aqui as duas são um botão
// que conclui a palavra e outro que segue (o "Continuar" do painel)
vi.mock('../components/ExerciseFingerspell', () => ({
  ExerciseFingerspell: ({ word, onAnswer, onNext }: { word: string; onAnswer: (c: boolean) => void; onNext: () => void }) => (
    <div>
      <p>palavra {word}</p>
      <button onClick={() => onAnswer(true)}>fazer</button>
      <button onClick={() => { onAnswer(false); onNext(); }}>pular</button>
      <button onClick={onNext}>seguir</button>
    </div>
  ),
}));
vi.mock('../components/ExerciseOrderSequence', () => ({
  ExerciseOrderSequence: ({ prompt, onAnswer, onNext }: { prompt: string; onAnswer: (c: boolean) => void; onNext: () => void }) => (
    <div>
      <p>{prompt}</p>
      <button onClick={() => onAnswer(true)}>fazer</button>
      <button onClick={() => { onAnswer(false); onNext(); }}>pular</button>
      <button onClick={onNext}>seguir</button>
    </div>
  ),
}));
vi.mock('../recognition/landmarker', () => ({ warmUpHandLandmarker: vi.fn() }));

import { SpellChallengeScreen } from '../screens/SpellChallengeScreen';

const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÇ'];
const repoWith = (glosses: string[]) => ({
  listSrsItems: async () => glosses.map((g) => ({ signId: `letra-${g}` })),
}) as unknown as IdbRepo;

async function open(glosses = ALPHABET) {
  const onBack = vi.fn();
  render(<SpellChallengeScreen userId="u" repo={repoWith(glosses)} onBack={onBack} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  return onBack;
}

/** Faz uma palavra levando `ms` e segue para a próxima. */
function word(ms: number, skip = false) {
  act(() => { vi.advanceTimersByTime(ms); });
  if (skip) {
    fireEvent.click(screen.getByRole('button', { name: 'pular' }));
    return;
  }
  fireEvent.click(screen.getByRole('button', { name: 'fazer' }));
  // o tempo no painel de "palavra feita" não conta
  act(() => { vi.advanceTimersByTime(10_000); });
  fireEvent.click(screen.getByRole('button', { name: 'seguir' }));
}

describe('SpellChallengeScreen (desafio de soletrar)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'performance'] });
    setLetterMotionModelForTests({ model: { labels: ['J', '_'], normalizationVersion: 2, inputDim: 552, layers: [] } as unknown as MlpModel });
  });
  afterEach(() => {
    vi.useRealTimers();
    setLetterMotionModelForTests(null);
    localStorage.clear();
    document.documentElement.removeAttribute('data-reduced-motion');
  });

  it('sem letras suficientes vistas, o desafio fica bloqueado', async () => {
    await open([...'ABC']);
    expect(screen.getByText(/Faça as lições do alfabeto/)).toBeInTheDocument();
  });

  it('contagem 3, 2, 1, relógio na tela e o melhor tempo guardado ao terminar as 3 palavras', async () => {
    await open();
    expect(screen.getByText('Ainda sem recorde.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Começar/ }));
    expect(screen.getByText('3')).toBeInTheDocument();
    for (const n of ['2', '1']) {
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByText(n)).toBeInTheDocument();
    }
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Palavra 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    word(4000);
    expect(screen.getByText('Palavra 2 de 3')).toBeInTheDocument();
    word(5000);
    word(6000);
    expect(screen.getByText('Desafio concluído!')).toBeInTheDocument();
    expect(screen.getByText('Seu tempo: 0:15')).toBeInTheDocument();
    expect(screen.getByText('Novo recorde pessoal!')).toBeInTheDocument();
    expect(localStorage.getItem('librax_spellChallengeBest')).toBe('15000');
  });

  it('com menos movimento: sem contagem regressiva e sem relógio correndo, o tempo aparece no fim', async () => {
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Começar/ }));
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.getByText('Palavra 1 de 3')).toBeInTheDocument();
    expect(screen.queryByRole('timer')).not.toBeInTheDocument();
    expect(screen.getByText('Tempo no final')).toBeInTheDocument();
    word(2000);
    word(2000);
    word(2000);
    expect(screen.getByText('Seu tempo: 0:06')).toBeInTheDocument();
  });

  it('pular uma palavra termina o desafio sem valer recorde', async () => {
    localStorage.setItem('librax_spellChallengeBest', '60000');
    document.documentElement.setAttribute('data-reduced-motion', 'true');
    await open();
    expect(screen.getByText('Seu melhor: 1:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Começar/ }));
    word(1000);
    word(1000, true);
    word(1000);
    expect(screen.getByText(/não vale recorde/)).toBeInTheDocument();
    expect(localStorage.getItem('librax_spellChallengeBest')).toBe('60000');
  });
});
