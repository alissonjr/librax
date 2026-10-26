import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { Classifier } from '../recognition/classifier';

// Hook do modo livre: os modelos de cada modo e a troca entre Letras e Números (sem câmera de
// verdade). A leitura quadro a quadro é a de freeSpell.ts.

const models = vi.hoisted(() => ({
  numbers: null as Classifier | null,
  motion: null as unknown,
  motionLetters: new Set<string>(),
}));

vi.mock('../recognition/landmarker', () => ({
  getHandLandmarker: vi.fn(async () => ({})),
  peekHandLandmarker: vi.fn(() => null),
  detectHands: vi.fn(),
}));
vi.mock('../recognition/numberModel', () => ({
  loadNumberClassifier: vi.fn(async () => models.numbers),
}));
vi.mock('../recognition/letterMotionModel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../recognition/letterMotionModel')>()),
  loadLetterMotionModel: vi.fn(async () => models.motion),
  getMotionLetters: vi.fn(() => models.motionLetters),
}));

import { useFreeModeCamera } from '../hooks/useFreeModeCamera';
import { getHandLandmarker } from '../recognition/landmarker';
import { setClassifierForTests, type ClassifierKind } from '../recognition/classifier';

const numberClassifier: Classifier = {
  kind: 'mlp' as ClassifierKind,
  letters: new Set(['0', '2', '8']),
  classify: () => ({ letter: null, confidence: 0, extensions: { thumb: false, index: false, middle: false, ring: false, pinky: false } }),
};

beforeEach(() => {
  vi.clearAllMocks();
  models.numbers = numberClassifier;
  models.motion = null;
  models.motionLetters = new Set();
  setClassifierForTests(null);
  const stream = { getTracks: () => [{ stop: vi.fn() }] };
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: vi.fn(async () => stream) },
    configurable: true,
  });
});

describe('useFreeModeCamera', () => {
  it('em Letras lista as letras paradas; sem o modelo de movimento, nenhuma com movimento', async () => {
    const { result } = renderHook(() => useFreeModeCamera('letras'));
    await act(async () => { await result.current.start(); });
    await waitFor(() => expect(result.current.recognizable?.still).toContain('A'));
    expect(result.current.recognizable?.motion).toEqual([]);
    expect(getHandLandmarker).toHaveBeenCalledWith(2);
    expect(result.current.status).toBe('active');
  });

  it('trocar para Números carrega o modelo dos números e lista só os que passaram no teste', async () => {
    const { result, rerender } = renderHook(({ mode }) => useFreeModeCamera(mode), {
      initialProps: { mode: 'letras' as 'letras' | 'numeros' },
    });
    rerender({ mode: 'numeros' });
    await waitFor(() => expect(result.current.recognizable).toEqual({ still: ['0', '2', '8'], motion: [], unavailable: false }));
  });

  it('números sem modelo ficam indisponíveis, sem erro', async () => {
    models.numbers = null;
    const { result } = renderHook(() => useFreeModeCamera('numeros'));
    await act(async () => { await result.current.start(); });
    await waitFor(() => expect(result.current.recognizable?.unavailable).toBe(true));
    expect(getHandLandmarker).toHaveBeenCalledWith(1);
  });

  it('sem câmera no navegador o status vira unsupported', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    const { result } = renderHook(() => useFreeModeCamera('letras'));
    await act(async () => { await result.current.start(); });
    expect(result.current.status).toBe('unsupported');
  });

  it('espaço, apagar e limpar sem texto não fazem nada', () => {
    const { result } = renderHook(() => useFreeModeCamera('letras'));
    act(() => {
      result.current.addSpace();
      result.current.deleteLast();
      result.current.clear();
    });
    expect(result.current.view.text).toBe('');
  });
});
