/**
 * Mantém a tela acesa enquanto a câmera está ligada (seção 3.3 do plano mobile web).
 * Safari 16.4+ e Chrome Android têm a Screen Wake Lock API; sem ela, não faz nada.
 * O sistema solta o bloqueio quando a aba sai de cena; ao voltar, pedimos de novo.
 */

export type WakeLockStatus = 'unsupported' | 'pending' | 'active' | 'denied' | 'released';

export interface WakeLockHandle {
  status(): WakeLockStatus;
  release(): void;
}

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<Sentinel> };
};

export function keepScreenOn(onChange?: (status: WakeLockStatus) => void): WakeLockHandle {
  const api = (navigator as NavigatorWithWakeLock).wakeLock;
  let status: WakeLockStatus = api ? 'pending' : 'unsupported';
  let sentinel: Sentinel | null = null;
  let done = false;

  const set = (s: WakeLockStatus) => {
    status = s;
    onChange?.(s);
  };

  const request = async () => {
    if (!api || done || document.visibilityState !== 'visible') return;
    try {
      const s = await api.request('screen');
      if (done) { s.release().catch(() => {}); return; }
      sentinel = s;
      s.addEventListener('release', () => {
        sentinel = null;
        if (!done) set('released');
      });
      set('active');
    } catch {
      // Recusado (economia de bateria, iframe sem permissão) ou aba já escondida
      set('denied');
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !sentinel) request();
  };

  if (api) {
    document.addEventListener('visibilitychange', onVisibility);
    request();
  } else {
    onChange?.(status);
  }

  return {
    status: () => status,
    release() {
      if (done) return;
      done = true;
      document.removeEventListener('visibilitychange', onVisibility);
      sentinel?.release().catch(() => {});
      sentinel = null;
    },
  };
}
