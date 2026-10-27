import { getSession, type Session } from './auth';

/**
 * Aparelho da conta (aviso de acesso novo e idioma dos e-mails): services/api/src/handlers/devices.js.
 *
 * Com conta, o app chama POST /v1/users/me/devices depois de entrar e quando o idioma muda, com:
 * - `deviceId`: um código aleatório criado neste navegador (`librax_deviceId`), sem nada do aparelho
 *   (nenhuma impressão digital). O servidor guarda só um hash dele com a conta;
 * - `lang`: o idioma do app, para os e-mails (lembretes e avisos) saírem nele;
 * - `timezone`: o fuso do aparelho, para a hora do aviso.
 *
 * O servidor tira do User-Agent só o tipo de aparelho, o sistema e o navegador. Se a conta entrou num
 * aparelho que ela ainda não tinha, manda um e-mail (com o SES ligado na infra). Falha de rede ou da
 * API não muda nada no app: tenta de novo na próxima abertura.
 */

const DEVICE_ID_KEY = 'librax_deviceId';

export interface DeviceDeps {
  fetch: typeof fetch;
  getSession: () => Promise<Session | null>;
  apiBase: string;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  timeZone: () => string | undefined;
}

const defaults = (): DeviceDeps => ({
  fetch: (...args) => fetch(...args),
  getSession,
  apiBase: import.meta.env.VITE_API_BASE || '/api',
  storage: typeof localStorage === 'undefined' ? null : localStorage,
  timeZone: () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  },
});

/** Código aleatório deste navegador (criado na primeira vez). Sem armazenamento, um por visita. */
export function getDeviceId(storage: DeviceDeps['storage'] = defaults().storage): string {
  try {
    const saved = storage?.getItem(DEVICE_ID_KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return saved;
    const id = crypto.randomUUID();
    storage?.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** Última combinação conta + idioma avisada nesta visita: não repete a mesma chamada. */
let lastReported: string | null = null;

/**
 * Avisa o servidor do aparelho e do idioma. Devolve `true` se a chamada foi feita e aceita.
 * Sem sessão (convidado) não faz nada.
 */
export async function reportDevice(lang: string, overrides: Partial<DeviceDeps> = {}): Promise<boolean> {
  const deps = { ...defaults(), ...overrides };
  try {
    const session = await deps.getSession();
    if (!session) return false;
    const key = `${session.userId}|${lang}`;
    if (key === lastReported) return false;
    lastReported = key;
    const timezone = deps.timeZone();
    const res = await deps.fetch(`${deps.apiBase}/v1/users/me/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ deviceId: getDeviceId(deps.storage), lang, ...(timezone ? { timezone } : {}) }),
    });
    if (!res.ok) lastReported = null;
    return res.ok;
  } catch {
    lastReported = null;
    return false;
  }
}

/** Testes: esquece a última chamada. */
export function __resetDeviceForTests(): void {
  lastReported = null;
}
