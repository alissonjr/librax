/**
 * Instalação do PWA ("adicionar à tela inicial"), decisão 13 do plano mobile web.
 *
 * - Android (Chrome, Samsung Internet): o navegador dispara `beforeinstallprompt`; guardamos o
 *   evento e mostramos o pedido nativo só quando a pessoa toca em "Instalar".
 * - iPhone (Safari, e qualquer navegador do iOS): não há evento; mostramos as instruções de
 *   "Compartilhar > Adicionar à Tela de Início".
 * Nunca é obrigatório: a sugestão aparece uma vez só, ao voltar para o mapa (shouldSuggestInstall),
 * e pode ser dispensada. Nas Configurações a opção continua disponível enquanto não estiver instalado.
 */

/** Sem conta, a sugestão de instalar vem depois desta quantidade de lições concluídas. */
export const INSTALL_WITHOUT_ACCOUNT_AFTER = 3;

/**
 * Quando sugerir instalar (decisão 13 do plano, spec-02 12.1):
 * - com conta: depois da primeira lição concluída (o pedido de conta vem antes, no fim da lição);
 * - sem conta: depois da terceira lição concluída, porque no iPhone o app instalado fica livre da
 *   limpeza de 7 dias do Safari e protege o progresso de quem só joga como convidado;
 * - uma vez só (`alreadySuggested`). Conclusões repetidas da mesma lição também contam.
 */
export function shouldSuggestInstall(opts: {
  alreadySuggested: boolean;
  lessonsCompleted: number;
  hasAccount: boolean;
}): boolean {
  if (opts.alreadySuggested || opts.lessonsCompleted < 1) return false;
  return opts.hasAccount || opts.lessonsCompleted >= INSTALL_WITHOUT_ACCOUNT_AFTER;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios' | null;

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Liga a escuta dos eventos. Chamado uma vez no main.tsx, antes de o React montar. */
export function initInstall(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    // Segura o mini-infobar do Chrome: o app decide o momento de sugerir
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

/** Aberto como app (tela inicial), e não numa aba do navegador. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

/** iPhone ou iPad (o iPad com iPadOS se apresenta como Mac, mas tem toque). */
export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** Como dá para instalar agora: pedido nativo, instruções do iOS, ou nada. */
export function getInstallMode(): InstallMode {
  if (installed || isStandalone()) return null;
  if (deferred) return 'prompt';
  if (isIos()) return 'ios';
  return null;
}

/** Abre o pedido nativo de instalação (Android). Retorna true se a pessoa aceitou. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // O evento só pode ser usado uma vez
  deferred = null;
  notify();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === 'accepted';
}

export function subscribeInstall(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
