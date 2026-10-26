import { ROUTES } from './routes';
import { versionId } from './appVersion';

/*
 * Atualização do app (PWA). O service worker continua registrado pelo vite-plugin-pwa (registerSW.js,
 * injetado no index.html, registerType 'autoUpdate': o novo assume sozinho, sem recarregar a página).
 * Aqui só entra o que faltava para a pessoa saber que o app mudou:
 *   1. procurar versão nova ao voltar para o app (visibilitychange, no máximo a cada 5 min) e a
 *      cada hora com ele aberto: só baixa o sw.js, e só se o app estiver visível e online. O iPhone
 *      instalado quase nunca recarrega a página, então sem isso a versão nova demora a chegar;
 *   2. quando um service worker novo assume (controllerchange), recarregar para rodar o código novo,
 *      mas só no mapa ou nas Configurações: nunca no meio de uma lição ou da câmera;
 *   3. na abertura seguinte (depois do recarregar ou do próximo uso), o aviso curto "App atualizado",
 *      uma vez, também só no mapa ou nas Configurações.
 */

export const SEEN_VERSION_KEY = 'librax_seenVersion';
/** Intervalo entre buscas com o app aberto. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Ao voltar para o app, busca de novo só se a última foi há mais que isso. */
export const UPDATE_CHECK_MIN_GAP_MS = 5 * 60 * 1000;

/** Telas onde recarregar e avisar não atrapalham: o mapa (Aprender) e as Configurações. */
export function isSafeForUpdate(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === ROUTES.home || path === ROUTES.learn || path === ROUTES.settings;
}

/**
 * Versão desta abertura comparada com a última que a pessoa viu. Primeira abertura (nada guardado):
 * guarda e não avisa. Mesma versão: nada. Outra versão: avisa (fica guardada só quando o aviso
 * aparece, em markVersionSeen, para não se perder se o app fechar antes).
 */
export function hasNewVersion(current: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): boolean {
  if (!storage) return false;
  try {
    const seen = storage.getItem(SEEN_VERSION_KEY);
    if (seen === null) {
      storage.setItem(SEEN_VERSION_KEY, current);
      return false;
    }
    return seen !== current;
  } catch {
    return false;
  }
}

export function markVersionSeen(current: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(SEEN_VERSION_KEY, current);
  } catch {
    /* sem armazenamento: o aviso pode voltar na próxima abertura, sem outro efeito */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/* ---------- estado (lido pelo AppUpdateNotice) ---------- */

export type NoticeState = 'none' | 'pending' | 'showing' | 'done';

export interface AppUpdateState {
  /** Aviso "App atualizado": pending espera uma tela segura; showing está na tela. */
  notice: NoticeState;
  /** Um service worker novo assumiu: falta recarregar para rodar o código novo. */
  reloadPending: boolean;
}

let state: AppUpdateState = { notice: 'none', reloadPending: false };
const listeners = new Set<() => void>();

function setState(next: Partial<AppUpdateState>) {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

export function getAppUpdateState(): AppUpdateState {
  return state;
}

export function subscribeAppUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** O aviso entrou na tela: conta como visto (aparece uma vez só). */
export function beginUpdateNotice(current: string = versionId()): void {
  if (state.notice !== 'pending') return;
  markVersionSeen(current);
  setState({ notice: 'showing' });
}

export function endUpdateNotice(): void {
  if (state.notice === 'showing') setState({ notice: 'done' });
}

let reloading = false;
/** Recarrega uma vez para o código novo (chamado só numa tela segura). */
export function reloadForUpdate(reload: () => void = () => window.location.reload()): void {
  if (reloading || !state.reloadPending) return;
  reloading = true;
  reload();
}

/** Só para os testes. */
export function resetAppUpdate(next: Partial<AppUpdateState> = {}): void {
  state = { notice: 'none', reloadPending: false, ...next };
  reloading = false;
  listeners.forEach((fn) => fn());
}

/* ---------- início (main.tsx) ---------- */

interface InitDeps {
  win?: Window;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  current?: string;
  now?: () => number;
}

/**
 * Liga tudo na abertura do app. Devolve a função que desliga (testes). Sem service worker (servidor
 * de desenvolvimento, navegador antigo), só o aviso de versão funciona.
 */
export function initAppUpdate({ win = window, storage = safeStorage(), current = versionId(), now = Date.now }: InitDeps = {}): () => void {
  if (hasNewVersion(current, storage)) setState({ notice: 'pending' });

  const sw = win.navigator.serviceWorker;
  if (!sw) return () => {};

  // Sem controlador agora: é a primeira instalação, e o clientsClaim dela não é atualização
  let hadController = !!sw.controller;
  const onControllerChange = () => {
    if (hadController) setState({ reloadPending: true });
    hadController = !!sw.controller;
  };
  sw.addEventListener('controllerchange', onControllerChange);

  let lastCheck = now();
  const check = () => {
    if (win.document.visibilityState !== 'visible' || win.navigator.onLine === false) return;
    lastCheck = now();
    sw.getRegistration().then((reg) => reg?.update()).catch(() => {});
  };
  const onVisibility = () => {
    if (win.document.visibilityState === 'visible' && now() - lastCheck >= UPDATE_CHECK_MIN_GAP_MS) check();
  };
  win.document.addEventListener('visibilitychange', onVisibility);
  const timer = win.setInterval(check, UPDATE_CHECK_INTERVAL_MS);

  return () => {
    sw.removeEventListener('controllerchange', onControllerChange);
    win.document.removeEventListener('visibilitychange', onVisibility);
    win.clearInterval(timer);
  };
}
