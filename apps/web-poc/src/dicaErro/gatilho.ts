/*
 * Quando a dica de erro aparece. A câmera leu outra letra (ou número) no lugar da pedida:
 * - de forma estável duas vezes (duas leituras estáveis separadas, com outra coisa no meio), ou
 * - parada nessa leitura errada por HOLD_MS, ou
 * - já confirmada pela regra de leitura (letras com movimento: a mesma letra em duas avaliações
 *   seguidas), aí basta uma.
 * No máximo uma dica por tentativa: depois de aberta, só volta quando a pessoa fecha (e aí precisa de
 * novas leituras erradas; a mesma leitura parada na tela não reabre) ou tenta de novo (a câmera
 * reinicia). Acertou, a dica some e não volta.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

/** Leituras estáveis da mesma letra errada para abrir a dica. */
export const WRONG_READINGS = 2;
/** Tempo parado numa leitura errada que também abre a dica (ms). */
export const HOLD_MS = 3000;

export interface TriggerOptions {
  target: string;
  /** A leitura já vem confirmada (duas avaliações seguidas): uma basta. */
  confirmed?: boolean;
  readings?: number;
  holdMs?: number;
}

export interface TriggerState {
  /** Leitura atual e desde quando (ms). */
  current: string | null;
  since: number;
  /** Leituras estáveis separadas de cada rótulo errado nesta tentativa. */
  counts: Record<string, number>;
  /** Rótulo lido que a dica aberta mostra. */
  shown: string | null;
  /** A dica já abriu nesta tentativa. */
  used: boolean;
  /** Leitura que estava na tela quando a pessoa fechou: parada ali, não reabre pelo tempo. */
  blocked: string | null;
  done: boolean;
}

export type TriggerEvent =
  | { type: 'reading'; label: string | null; now: number }
  | { type: 'tick'; now: number }
  | { type: 'dismiss'; now: number }
  | { type: 'retry'; now: number }
  | { type: 'success' };

export const initialTrigger = (now = 0): TriggerState => ({
  current: null, since: now, counts: {}, shown: null, used: false, blocked: null, done: false,
});

const isWrong = (label: string | null, target: string): label is string => !!label && label !== target;

export function triggerReducer(state: TriggerState, event: TriggerEvent, opts: TriggerOptions): TriggerState {
  const readings = opts.confirmed ? 1 : opts.readings ?? WRONG_READINGS;
  const holdMs = opts.holdMs ?? HOLD_MS;
  switch (event.type) {
    case 'success':
      return { ...state, shown: null, used: true, done: true };
    case 'retry':
      return { ...initialTrigger(event.now), done: state.done };
    case 'dismiss':
      return { ...state, shown: null, used: false, counts: {}, since: event.now, blocked: state.current };
    case 'reading': {
      if (event.label === state.current) return state;
      if (event.label === opts.target) return { ...state, current: event.label, since: event.now, blocked: null };
      const next: TriggerState = { ...state, current: event.label, since: event.now, blocked: null };
      if (state.done || state.used || !isWrong(event.label, opts.target)) return next;
      const n = (state.counts[event.label] ?? 0) + 1;
      next.counts = { ...state.counts, [event.label]: n };
      if (n >= readings) {
        next.shown = event.label;
        next.used = true;
      }
      return next;
    }
    case 'tick': {
      if (state.done || state.used || !isWrong(state.current, opts.target) || state.current === state.blocked) return state;
      if (event.now - state.since < holdMs) return state;
      return { ...state, shown: state.current, used: true };
    }
  }
}

/**
 * Leitura simulada para conferência em desenvolvimento (?leitura=H, como o ?mao3d=meio da mão em
 * 3D): só a dica vê, a nota do exercício continua com a câmera. Fora do modo de desenvolvimento,
 * nada.
 */
export function devSimulatedReading(): string | null {
  if (!import.meta.env.DEV || typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get('leitura');
}

export interface WrongReadingHint {
  /** O que a câmera leu, enquanto a dica está aberta; senão null. */
  read: string | null;
  dismiss: () => void;
  /** A pessoa tentou de novo (a câmera reiniciou): a dica pode voltar. */
  retry: () => void;
}

/**
 * A dica de um exercício com câmera. `reading` é a leitura estável (letra parada) ou a confirmada
 * (letra com movimento, `confirmed`); `succeeded` fecha de vez.
 */
export function useWrongReadingHint(
  target: string,
  reading: string | null,
  { confirmed = false, succeeded = false, enabled = true }: { confirmed?: boolean; succeeded?: boolean; enabled?: boolean } = {},
): WrongReadingHint {
  const optsRef = useRef<TriggerOptions>({ target, confirmed });
  optsRef.current = { target, confirmed };
  const [state, dispatch] = useReducer(
    (s: TriggerState, e: TriggerEvent) => triggerReducer(s, e, optsRef.current),
    undefined,
    () => initialTrigger(now()),
  );
  const simulated = useRef(devSimulatedReading()).current;
  const input = enabled ? simulated ?? reading : null;

  useEffect(() => {
    dispatch({ type: 'reading', label: input, now: now() });
  }, [input]);

  useEffect(() => {
    if (succeeded) dispatch({ type: 'success' });
  }, [succeeded]);

  // Parada numa leitura errada: confere de novo quando o tempo vence
  const waiting = !state.used && !state.done && isWrong(state.current, target) && state.current !== state.blocked;
  useEffect(() => {
    if (!waiting) return;
    const wait = Math.max(0, state.since + HOLD_MS - now()) + 20;
    const timer = setTimeout(() => dispatch({ type: 'tick', now: now() }), wait);
    return () => clearTimeout(timer);
  }, [waiting, state.since]);

  const dismiss = useCallback(() => dispatch({ type: 'dismiss', now: now() }), []);
  const retry = useCallback(() => dispatch({ type: 'retry', now: now() }), []);
  return { read: state.shown, dismiss, retry };
}

/** Relógio da regra do tempo (Date: os testes controlam com os timers falsos). */
function now(): number {
  return Date.now();
}
