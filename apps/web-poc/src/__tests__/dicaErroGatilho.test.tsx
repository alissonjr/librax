import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  HOLD_MS, initialTrigger, triggerReducer, useWrongReadingHint, type TriggerEvent, type TriggerOptions, type TriggerState,
} from '../dicaErro/gatilho';

function run(events: TriggerEvent[], opts: TriggerOptions = { target: 'K' }, start: TriggerState = initialTrigger()) {
  return events.reduce((s, e) => triggerReducer(s, e, opts), start);
}
const r = (label: string | null, now: number): TriggerEvent => ({ type: 'reading', label, now });

describe('gatilho da dica de erro (regras)', () => {
  it('abre depois de duas leituras estáveis da mesma letra errada, com outra coisa no meio', () => {
    expect(run([r('H', 0)]).shown).toBeNull();
    expect(run([r('H', 0), r(null, 500), r('H', 900)]).shown).toBe('H');
    expect(run([r('H', 0), r('G', 500), r('H', 900)]).shown).toBe('H');
  });

  it('duas letras erradas diferentes, uma vez cada: não abre', () => {
    expect(run([r('H', 0), r('G', 500), r(null, 900)]).shown).toBeNull();
  });

  it('a letra pedida não conta como erro', () => {
    expect(run([r('K', 0), r(null, 200), r('K', 400)]).shown).toBeNull();
  });

  it('parada na mesma leitura errada por HOLD_MS: abre', () => {
    const s = run([r('H', 0)]);
    expect(triggerReducer(s, { type: 'tick', now: HOLD_MS - 1 }, { target: 'K' }).shown).toBeNull();
    expect(triggerReducer(s, { type: 'tick', now: HOLD_MS }, { target: 'K' }).shown).toBe('H');
  });

  it('leitura já confirmada (letras com movimento): uma basta', () => {
    expect(run([r('H', 0)], { target: 'K', confirmed: true }).shown).toBe('H');
  });

  it('no máximo uma por tentativa: aberta, outra letra errada não troca a dica', () => {
    const s = run([r('H', 0), r(null, 100), r('H', 200), r('G', 300), r(null, 400), r('G', 500)]);
    expect(s.shown).toBe('H');
  });

  it('fechar: some, e só volta com novas leituras (parada na mesma leitura, não volta pelo tempo)', () => {
    let s = run([r('H', 0), r(null, 100), r('H', 200)]);
    s = triggerReducer(s, { type: 'dismiss', now: 300 }, { target: 'K' });
    expect(s.shown).toBeNull();
    expect(triggerReducer(s, { type: 'tick', now: 300 + HOLD_MS * 2 }, { target: 'K' }).shown).toBeNull();
    s = run([r(null, 400), r('H', 500)], { target: 'K' }, s);
    expect(s.shown).toBeNull();
    s = run([r(null, 600), r('H', 700)], { target: 'K' }, s);
    expect(s.shown).toBe('H');
  });

  it('tentar de novo zera a tentativa; acertar fecha de vez', () => {
    let s = run([r('H', 0), r(null, 100), r('H', 200)]);
    s = triggerReducer(s, { type: 'retry', now: 300 }, { target: 'K' });
    expect(s.shown).toBeNull();
    expect(run([r('H', 400), r(null, 500), r('H', 600)], { target: 'K' }, s).shown).toBe('H');
    const done = triggerReducer(s, { type: 'success' }, { target: 'K' });
    expect(run([r('H', 400), r(null, 500), r('H', 600)], { target: 'K' }, done).shown).toBeNull();
  });
});

describe('useWrongReadingHint', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('abre pelo tempo parado numa leitura errada e fecha ao dispensar', () => {
    const { result, rerender } = renderHook(({ reading }) => useWrongReadingHint('K', reading), { initialProps: { reading: null as string | null } });
    rerender({ reading: 'H' });
    expect(result.current.read).toBeNull();
    act(() => { vi.advanceTimersByTime(HOLD_MS + 100); });
    expect(result.current.read).toBe('H');
    act(() => result.current.dismiss());
    expect(result.current.read).toBeNull();
  });

  it('confirmada abre na hora; acerto fecha; desligada (demonstração aberta) não abre', () => {
    const { result, rerender } = renderHook(
      ({ reading, succeeded, enabled }) => useWrongReadingHint('K', reading, { confirmed: true, succeeded, enabled }),
      { initialProps: { reading: null as string | null, succeeded: false, enabled: false } },
    );
    rerender({ reading: 'H', succeeded: false, enabled: false });
    expect(result.current.read).toBeNull();
    rerender({ reading: 'H', succeeded: false, enabled: true });
    expect(result.current.read).toBe('H');
    rerender({ reading: 'K', succeeded: true, enabled: true });
    expect(result.current.read).toBeNull();
  });
});
