import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UseFreeModeCameraReturn, FreeView } from '../hooks/useFreeModeCamera';

// Modo livre: a tela sobre o hook da câmera (simulado). A arbitragem das leituras é testada em
// freeSpell.test.ts; aqui, a troca de modo, os controles do texto, a dica e os anúncios.

const actions = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  deleteLast: vi.fn(),
  clear: vi.fn(),
  addSpace: vi.fn(),
}));

const EMPTY_VIEW: FreeView = { text: '', current: null, hint: null, hintLetter: null, lastEvent: null, handPresent: false };

function camera(patch: Partial<UseFreeModeCameraReturn> = {}): UseFreeModeCameraReturn {
  return {
    videoRef: { current: null },
    canvasRef: { current: null },
    status: 'active',
    view: EMPTY_VIEW,
    recognizable: { still: ['A', 'B', 'C', 'O'], motion: ['J', 'Ç'], unavailable: false },
    ...actions,
    ...patch,
  };
}

vi.mock('../hooks/useFreeModeCamera', () => ({ useFreeModeCamera: vi.fn() }));
vi.mock('../recognition/landmarker', () => ({ warmUpHandLandmarker: vi.fn() }));

import { useFreeModeCamera } from '../hooks/useFreeModeCamera';
import { FreeModeScreen } from '../screens/FreeModeScreen';

function withCamera(patch: Partial<UseFreeModeCameraReturn> = {}) {
  vi.mocked(useFreeModeCamera).mockImplementation(() => camera(patch));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  withCamera();
});

describe('FreeModeScreen', () => {
  it('começa em Letras; trocar para Números pede o reconhecedor dos números e lembra a escolha', async () => {
    render(<FreeModeScreen />);
    expect(screen.getByRole('radio', { name: 'Letras' })).toHaveAttribute('aria-checked', 'true');
    expect(useFreeModeCamera).toHaveBeenLastCalledWith('letras');
    await userEvent.click(screen.getByRole('radio', { name: 'Números' }));
    expect(screen.getByRole('radio', { name: 'Números' })).toHaveAttribute('aria-checked', 'true');
    expect(useFreeModeCamera).toHaveBeenLastCalledWith('numeros');
    expect(localStorage.getItem('librax_freeMode')).toBe('numeros');
  });

  it('as setas do teclado trocam o modo', async () => {
    render(<FreeModeScreen />);
    screen.getByRole('radio', { name: 'Letras' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Números' })).toHaveFocus();
    expect(useFreeModeCamera).toHaveBeenLastCalledWith('numeros');
  });

  it('sem texto: os botões de edição ficam desligados e aparece o convite para soletrar', () => {
    render(<FreeModeScreen />);
    expect(screen.getByText('Soletre e as letras aparecem aqui.')).toBeInTheDocument();
    for (const name of ['Espaço', 'Apagar', 'Limpar', 'Copiar']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });

  it('com texto: apagar, limpar e espaço chamam o hook; copiar manda o texto para a área de transferência', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    withCamera({ view: { ...EMPTY_VIEW, text: 'OI ', handPresent: true } });
    render(<FreeModeScreen />);
    expect(screen.getByText(/OI/)).toBeInTheDocument();
    // Já termina em espaço: o botão de espaço fica desligado
    expect(screen.getByRole('button', { name: 'Espaço' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(actions.deleteLast).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(actions.clear).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    expect(writeText).toHaveBeenCalledWith('OI');
    expect(await screen.findByText('Texto copiado.')).toBeInTheDocument();
  });

  it('a leitura atual aparece com a letra; letra nova é anunciada ao leitor de tela', () => {
    withCamera({
      view: {
        ...EMPTY_VIEW, text: 'CA', handPresent: true,
        current: { letter: 'A', confidence: 0.82, motion: false },
        lastEvent: { kind: 'add', char: 'A', seq: 2 },
      },
    });
    const { container } = render(<FreeModeScreen />);
    expect(container.querySelector('.fm-reading-letter')).toHaveTextContent('A');
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('A');
  });

  it('a troca do I pelo J é anunciada', () => {
    withCamera({
      view: { ...EMPTY_VIEW, text: 'J', handPresent: true, lastEvent: { kind: 'replace', char: 'J', seq: 3 } },
    });
    const { container } = render(<FreeModeScreen />);
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Trocado por J');
  });

  it('dica gentil quando a leitura não firma; dica do movimento para H, K e X parados', () => {
    withCamera({ view: { ...EMPTY_VIEW, handPresent: true, hint: 'hold' } });
    const { rerender } = render(<FreeModeScreen />);
    expect(screen.getByText('Segure a mão parada por um instante.')).toBeInTheDocument();
    withCamera({ view: { ...EMPTY_VIEW, handPresent: true, hint: 'motion', hintLetter: 'K' } });
    rerender(<FreeModeScreen />);
    expect(screen.getByText('O K tem movimento: faça o movimento da letra.')).toBeInTheDocument();
  });

  it('mostra as letras paradas e as com movimento que a câmera lê', () => {
    render(<FreeModeScreen />);
    expect(screen.getByText('Letras paradas')).toBeInTheDocument();
    expect(screen.getByText('Letras com movimento')).toBeInTheDocument();
    expect(screen.getByText('Ç')).toBeInTheDocument();
  });

  it('números sem modelo: avisa, sem quebrar a tela', () => {
    localStorage.setItem('librax_freeMode', 'numeros');
    withCamera({ recognizable: { still: [], motion: [], unavailable: true } });
    render(<FreeModeScreen />);
    expect(screen.getByText(/os números precisam do modelo da câmera/i)).toBeInTheDocument();
  });

  it('câmera parada: botão para ativar; sem câmera no aparelho: mensagem sem botão de tentar de novo', async () => {
    withCamera({ status: 'idle' });
    const { rerender } = render(<FreeModeScreen />);
    await userEvent.click(screen.getByRole('button', { name: /ativar câmera/i }));
    expect(actions.start).toHaveBeenCalledTimes(1);
    withCamera({ status: 'unsupported' });
    rerender(<FreeModeScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Este aparelho ou navegador não dá acesso à câmera.');
    expect(screen.queryByRole('button', { name: /tentar de novo/i })).not.toBeInTheDocument();
    withCamera({ status: 'denied' });
    rerender(<FreeModeScreen />);
    expect(screen.getByRole('button', { name: /tentar de novo/i })).toBeInTheDocument();
  });

  it('nada do modo livre vai para o banco local nem para a fila de envio', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    withCamera({ view: { ...EMPTY_VIEW, text: 'OLA', handPresent: true, lastEvent: { kind: 'add', char: 'A', seq: 3 } } });
    render(<FreeModeScreen />);
    await act(async () => {});
    // Só a preferência do modo pode ser guardada (e só quando a pessoa troca)
    expect(setItem.mock.calls.filter(([k]) => k !== 'librax_freeMode')).toEqual([]);
    setItem.mockRestore();
  });
});
