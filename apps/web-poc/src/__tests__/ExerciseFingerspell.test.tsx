import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  OWN_NAME_MAX, SPELL_START, confirmFreeStep, needsRelease, ownNameLetters, spellAdvance, spellGesture, spellStep,
  type SpellReader, type SpellReadings, type SpellState,
} from '../lib/fingerspell';
import type { UseSpellCameraReturn } from '../hooks/useSpellCamera';

const mockStart = vi.fn();
const mockStop = vi.fn();

const base: UseSpellCameraReturn = {
  videoRef: { current: null },
  canvasRef: { current: null },
  status: 'active',
  stableGesture: null,
  motionLetter: null,
  handPresent: true,
  confidence: 0.9,
  start: mockStart,
  stop: mockStop,
};

vi.mock('../hooks/useSpellCamera', () => ({
  useSpellCamera: vi.fn(() => base),
}));

import { useSpellCamera } from '../hooks/useSpellCamera';
import { ExerciseFingerspell } from '../components/ExerciseFingerspell';
import { setClassifierForTests } from '../recognition/classifier';

const NO_FINGERS = { thumb: false, index: false, middle: false, ring: false, pinky: false };

// Os testes antigos falam em "câmera": a leitura estável das letras paradas
const useCameraRecognizer = useSpellCamera;

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

  it('pausa entre letras ("nenhuma letra" do modelo chega como null) não conta nem volta a palavra', () => {
    const CHEGA = ['C', 'H', 'E', 'G', 'A'];
    expect(run(CHEGA, [null, 'C', null, null, 'H', null, 'E', null, 'G', null, 'A']).index).toBe(5);
    // null antes da primeira letra e no meio não mexe no estado
    expect(spellStep(CHEGA, SPELL_START, null)).toBe(SPELL_START);
    const s = run(CHEGA, ['C', 'H']);
    expect(spellStep(CHEGA, { ...s, waitingRelease: false }, null)).toEqual({ ...s, waitingRelease: false });
  });
});

describe('soletração com um leitor por letra (spellAdvance)', () => {
  /** Passa leituras (parada, com movimento) pela regra, com o leitor de cada letra. */
  function runMixed(letters: string[], readers: SpellReader[], readings: Partial<SpellReadings>[]) {
    return readings.reduce<SpellState>(
      (s, r) => spellAdvance(letters, readers, s, { still: null, motion: null, ...r }),
      SPELL_START,
    );
  }

  it('JOIA: o J vale pelo reconhecedor das letras com movimento, o resto pelo das paradas', () => {
    const letters = ['J', 'O', 'I', 'A'];
    const readers: SpellReader[] = ['letras-mov', 'letras', 'letras', 'letras'];
    // leitura parada não serve para o J, nem a com movimento para o O
    expect(runMixed(letters, readers, [{ still: 'J' }]).index).toBe(0);
    expect(runMixed(letters, readers, [{ motion: 'J' }, { motion: 'O' }]).index).toBe(1);
    expect(runMixed(letters, readers, [{ motion: 'J' }, { still: 'O' }, { still: 'I' }, { still: 'A' }]).index).toBe(4);
  });

  it('troca de leitor solta a espera da letra anterior, como uma pausa', () => {
    const letters = ['C', 'A', 'Ç', 'A'];
    const readers: SpellReader[] = ['letras', 'letras', 'letras-mov', 'letras'];
    // depois do Ç (com movimento) a leitura parada já é A: aceita direto
    const s = runMixed(letters, readers, [{ still: 'C' }, { still: 'A' }, { still: 'A', motion: 'Ç' }]);
    expect(s).toEqual({ index: 3, waitingRelease: true });
    expect(spellAdvance(letters, readers, s, { still: 'A', motion: 'Ç' }).index).toBe(4);
  });

  it('letra com movimento repetida precisa da pausa ("_" ou mão fora) entre as duas', () => {
    const letters = ['H', 'H'];
    const readers: SpellReader[] = ['letras-mov', 'letras-mov'];
    const s = runMixed(letters, readers, [{ motion: 'H' }]);
    expect(spellAdvance(letters, readers, s, { still: null, motion: 'H' })).toBe(s);
    expect(runMixed(letters, readers, [{ motion: 'H' }, { motion: null }, { motion: 'H' }]).index).toBe(2);
  });

  it('o "_" das letras paradas (leitura null) entre letras não conta nem volta a palavra', () => {
    const letters = ['K', 'I', 'W', 'I'];
    const readers: SpellReader[] = ['letras-mov', 'letras', 'letras', 'letras'];
    const s = runMixed(letters, readers, [{ motion: 'K' }, { still: null }, { still: 'I' }, { still: null }, { still: 'W' }, { still: 'I' }]);
    expect(s.index).toBe(4);
  });

  it('passo livre (Z sem câmera) só avança pela confirmação da pessoa', () => {
    const letters = ['A', 'Z', 'U', 'L'];
    const readers: SpellReader[] = ['letras', 'livre', 'letras', 'letras'];
    const s = runMixed(letters, readers, [{ still: 'A' }, { still: 'Z', motion: 'Z' }]);
    expect(s.index).toBe(1);
    expect(spellGesture(readers, s, letters.length, { still: 'Z', motion: 'Z' })).toBeNull();
    const freed = confirmFreeStep(letters, readers, s);
    expect(freed).toEqual({ index: 2, waitingRelease: false });
    // fora do passo livre, a confirmação não faz nada
    expect(confirmFreeStep(letters, readers, freed)).toBe(freed);
    expect(runMixed(letters, readers, [{ still: 'U' }, { still: 'L' }]).index).toBe(0);
    expect([{ still: 'U' }, { still: 'L' }].reduce<SpellState>((st, r) => spellAdvance(letters, readers, st, { motion: null, ...r }), freed).index).toBe(4);
  });

  it('números: os dígitos com câmera pelo modelo dos números, os outros livres', () => {
    const digits = ['2', '0'];
    const readers: SpellReader[] = ['numeros', 'numeros'];
    expect(runMixed(digits, readers, [{ still: '2' }, { still: '0' }]).index).toBe(2);
    const sixty: SpellReader[] = ['livre', 'numeros'];
    const s = confirmFreeStep(['6', '0'], sixty, SPELL_START);
    expect(spellAdvance(['6', '0'], sixty, s, { still: '0', motion: null }).index).toBe(2);
  });

  it('sem a lista de leitores, tudo é lido como letra parada (como antes)', () => {
    expect(runMixed(['B', 'I', 'A'], undefined as unknown as SpellReader[], [{ still: 'B' }, { still: 'I' }, { still: 'A' }]).index).toBe(3);
  });
});

describe('ownNameLetters (nome do perfil para o "soletre seu nome")', () => {
  it('primeiro nome em caixa alta, sem acento e só com letras', () => {
    expect(ownNameLetters('Ana Maria')).toEqual(['A', 'N', 'A']);
    expect(ownNameLetters('  álvaro  ')).toEqual(['A', 'L', 'V', 'A', 'R', 'O']);
    expect(ownNameLetters("D'Ávila")).toEqual(['D', 'A', 'V', 'I', 'L', 'A']);
    expect(ownNameLetters('Bruna2')).toEqual(['B', 'R', 'U', 'N', 'A']);
    expect(ownNameLetters('Ítalo')).toEqual(['I', 'T', 'A', 'L', 'O']);
  });

  it('J, Z e Ç (letras com movimento) entram: cada letra tem o seu leitor na soletração', () => {
    expect(ownNameLetters('João')).toEqual(['J', 'O', 'A', 'O']);
    expect(ownNameLetters('Zeca')).toEqual(['Z', 'E', 'C', 'A']);
    expect(ownNameLetters('Graça')).toEqual(['G', 'R', 'A', 'Ç', 'A']);
    // o Ç continua Ç (não vira C), mesmo escrito com o cedilha separado
    expect(ownNameLetters('Iraça')).toEqual(['I', 'R', 'A', 'Ç', 'A']);
    // Conceição tem 9 letras: passa do limite
    expect(ownNameLetters('Conceição')).toBeNull();
  });

  it('vazio, de uma letra ou com mais de OWN_NAME_MAX letras não dá', () => {
    expect(ownNameLetters(null)).toBeNull();
    expect(ownNameLetters(undefined)).toBeNull();
    expect(ownNameLetters('   ')).toBeNull();
    expect(ownNameLetters('A')).toBeNull();
    expect(ownNameLetters('Wellington')).toBeNull();
    expect(ownNameLetters('Henrique')).toHaveLength(OWN_NAME_MAX);
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

  it('"soletre seu nome": o enunciado diz que é o nome, com câmera e sem ela', () => {
    const view = render(<ExerciseFingerspell word="BIA" letters={['B', 'I', 'A']} ownName onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Soletre seu nome: BIA' })).toBeInTheDocument();
    view.unmount();
    render(<ExerciseFingerspell word="OTO" letters={['O', 'T', 'O']} ownName onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Seu nome, OTO: coloque as letras na ordem' })).toBeInTheDocument();
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

  it('JOIA: o J sai do reconhecedor das letras com movimento e as outras das paradas', () => {
    const onAnswer = vi.fn();
    const letters = ['J', 'O', 'I', 'A'];
    const readers: SpellReader[] = ['letras-mov', 'letras', 'letras', 'letras'];
    const el = () => <ExerciseFingerspell word="JOIA" letters={letters} readers={readers} onAnswer={onAnswer} onNext={vi.fn()} />;
    // O fica fora do heurístico: um classificador que conhece as letras paradas da palavra
    setClassifierForTests({ kind: 'mlp', letters: new Set(['O', 'I', 'A']), classify: () => ({ letter: null, confidence: 0, extensions: NO_FINGERS }) });
    const view = render(el());
    expect(vi.mocked(useSpellCamera)).toHaveBeenLastCalledWith(letters, readers, 0);
    expect(screen.getByText(/Faça a letra J com o movimento/)).toBeInTheDocument();
    // a leitura parada "J" não conta: o J precisa do movimento
    vi.mocked(useSpellCamera).mockReturnValue({ ...base, stableGesture: 'J' });
    view.rerender(el());
    expect(screen.getByText('Letra 1 de 4: J')).toBeInTheDocument();
    vi.mocked(useSpellCamera).mockReturnValue({ ...base, motionLetter: 'J' });
    view.rerender(el());
    expect(screen.getByText('Letra 2 de 4: O')).toBeInTheDocument();
    expect(vi.mocked(useSpellCamera)).toHaveBeenLastCalledWith(letters, readers, 1);
    for (const g of ['O', 'I', 'A']) {
      vi.mocked(useSpellCamera).mockReturnValue({ ...base, motionLetter: 'J', stableGesture: g });
      view.rerender(el());
    }
    expect(screen.getByText('Palavra soletrada!')).toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledWith(true);
    act(() => setClassifierForTests(null));
  });

  it('letra sem câmera (Z): prática livre, avança quando a pessoa toca em "Fiz o Z"', async () => {
    const onAnswer = vi.fn();
    const letters = ['A', 'Z', 'U', 'L'];
    const readers: SpellReader[] = ['letras', 'livre', 'letras', 'letras'];
    const el = () => <ExerciseFingerspell word="AZUL" letters={letters} readers={readers} onAnswer={onAnswer} onNext={vi.fn()} />;
    const view = render(el());
    expect(screen.queryByRole('button', { name: /Fiz o/ })).not.toBeInTheDocument();
    vi.mocked(useSpellCamera).mockReturnValue({ ...base, stableGesture: 'A' });
    view.rerender(el());
    expect(screen.getByText('Letra 2 de 4: Z')).toBeInTheDocument();
    expect(screen.getByText(/Z sem avaliação/)).toBeInTheDocument();
    // a câmera não avança o passo livre, nem com uma leitura de Z
    vi.mocked(useSpellCamera).mockReturnValue({ ...base, stableGesture: 'Z', motionLetter: 'Z' });
    view.rerender(el());
    expect(screen.getByText('Letra 2 de 4: Z')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Fiz o Z/ }));
    expect(screen.getByText('Letra 3 de 4: U')).toBeInTheDocument();
    for (const g of ['U', 'L']) {
      vi.mocked(useSpellCamera).mockReturnValue({ ...base, stableGesture: g });
      view.rerender(el());
    }
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('número dígito a dígito: "Faça 20", 2 e depois 0 pelo modelo dos números', () => {
    const onAnswer = vi.fn();
    const readers: SpellReader[] = ['numeros', 'numeros'];
    const el = () => <ExerciseFingerspell word="20" letters={['2', '0']} readers={readers} numbers onAnswer={onAnswer} onNext={vi.fn()} />;
    const view = render(el());
    expect(screen.getByRole('heading', { name: 'Faça 20: um dígito de cada vez' })).toBeInTheDocument();
    expect(screen.getByText('Dígito 1 de 2: 2')).toBeInTheDocument();
    for (const g of ['2', '0']) {
      vi.mocked(useSpellCamera).mockReturnValue({ ...base, stableGesture: g });
      view.rerender(el());
    }
    expect(screen.getByText('Número feito!')).toBeInTheDocument();
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('número sem câmera em nenhum dígito cai no order_sequence com os dígitos', () => {
    setClassifierForTests({ kind: 'mlp', letters: new Set(['A']), classify: () => ({ letter: null, confidence: 0, extensions: NO_FINGERS }) });
    render(<ExerciseFingerspell word="20" letters={['2', '0']} numbers onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/Faça 20: coloque os dígitos na ordem/)).toBeInTheDocument();
    act(() => setClassifierForTests(null));
  });
});
