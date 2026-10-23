import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStableGesture } from '../hooks/useCameraRecognizer';

describe('useStableGesture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('confirma o gesto mantido pelo tempo minimo, mesmo sem novos renders', () => {
    const { result } = renderHook(({ raw }) => useStableGesture(raw), { initialProps: { raw: 'A' as string | null } });
    expect(result.current).toBeNull();
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe('A');
  });

  it('nao confirma enquanto a leitura oscila', () => {
    const { result, rerender } = renderHook(({ raw }) => useStableGesture(raw), { initialProps: { raw: 'A' as string | null } });
    for (let i = 0; i < 10; i++) {
      act(() => vi.advanceTimersByTime(200));
      rerender({ raw: i % 2 === 0 ? 'S' : 'A' });
    }
    expect(result.current).toBeNull();
  });

  it('troca para o novo gesto e volta a null quando a mao some', () => {
    const { result, rerender } = renderHook(({ raw }) => useStableGesture(raw), { initialProps: { raw: 'A' as string | null } });
    act(() => vi.advanceTimersByTime(400));
    rerender({ raw: 'B' });
    act(() => vi.advanceTimersByTime(399));
    expect(result.current).toBe('A');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe('B');
    rerender({ raw: null });
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBeNull();
  });
});
