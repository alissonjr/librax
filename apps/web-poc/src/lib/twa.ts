/**
 * App Android da loja (apps/android-twa): uma Trusted Web Activity, isto é, o Chrome abrindo este
 * mesmo site em tela cheia dentro de um app instalado pelo Google Play.
 *
 * Lá dentro o app já está instalado, então sugerir "Instalar o app" não faz sentido: getInstallMode
 * (lib/install.ts) volta null e somem a faixa do mapa, o convite e a opção das Configurações. O aviso
 * de versão nova (lib/appUpdate.ts) continua igual: o site é o mesmo e atualiza sozinho.
 *
 * Como o app se reconhece (nada é gravado fora desta aba nem enviado a lugar nenhum):
 * - o endereço de abertura do app Android leva `?origem=android` (gradle.properties do
 *   apps/android-twa); o parâmetro sai da barra na primeira leitura;
 * - o Chrome passa `android-app://<pacote>/` como document.referrer na abertura pelo app.
 * A marca fica no sessionStorage, que é desta aba: o TWA tem a própria, e o Chrome comum do mesmo
 * aparelho (que divide o localStorage com o TWA) não herda a marca.
 */

export const TWA_PARAM = 'origem';
export const TWA_PARAM_VALUE = 'android';

/** Pacotes do app Android (librax.applicationId no gradle.properties do apps/android-twa). */
export const TWA_PACKAGES = ['br.com.librax.app'];

const SESSION_KEY = 'librax_twa';

let cached: boolean | null = null;

/** O referrer é o da abertura pelo app Android (e não o de outro app, como Gmail ou WhatsApp). */
export function isTwaReferrer(referrer: string): boolean {
  const match = /^android-app:\/\/([^/?#]+)/.exec(referrer);
  return match !== null && TWA_PACKAGES.includes(match[1]);
}

/**
 * Lê a abertura pelo app Android e guarda a marca nesta aba. Chamado uma vez, antes de o React
 * montar (initInstall). Tira `?origem=android` da barra, mantendo o resto da URL.
 */
export function rememberTwaLaunch(win: Window = window): boolean {
  let fromParam = false;
  try {
    const url = new URL(win.location.href);
    if (url.searchParams.get(TWA_PARAM) === TWA_PARAM_VALUE) {
      fromParam = true;
      url.searchParams.delete(TWA_PARAM);
      try {
        win.history.replaceState(win.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      } catch {
        /* sem history: o parâmetro fica, sem efeito */
      }
    }
  } catch {
    /* URL inválida: segue pelo referrer */
  }
  const detected = fromParam || isTwaReferrer(win.document.referrer ?? '');
  if (detected) {
    try {
      win.sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      /* sem armazenamento: vale enquanto a página estiver aberta */
    }
  }
  cached = detected || readSession(win);
  return cached;
}

function readSession(win: Window): boolean {
  try {
    return win.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}

/** Aberto dentro do app Android da loja (TWA). */
export function isTwa(): boolean {
  if (typeof window === 'undefined') return false;
  if (cached === null) cached = readSession(window);
  return cached;
}

/** Só para testes: esquece a detecção desta página. */
export function resetTwaForTests(): void {
  cached = null;
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* sem armazenamento */
  }
}
