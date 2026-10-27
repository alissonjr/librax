import { isOnboarded } from './auth';

/**
 * Versão da Política de Privacidade que a pessoa já viu no app (`librax_policySeen`).
 *
 * - Quem termina as boas-vindas aceita a versão em vigor ali (LegalConsent) e fica marcado.
 * - Quem já usava o app antes da versão com os dados de uso anônimos vê uma vez o aviso curto no mapa
 *   (UsageNotice), com o link para a política e para o interruptor das Configurações.
 *
 * O número fica aqui (e não lido do privacidade.md) para o texto da política não entrar no pedaço
 * inicial do app; o teste da política confere que os dois são iguais.
 */
export const PRIVACY_POLICY_VERSION = '1.5';

/**
 * Versão que trouxe os dados de uso anônimos: o aviso do mapa é sobre ela. Versões depois dela (1.5:
 * lembretes, que só valem com o consentimento dado ao ligar) não mostram o aviso de novo.
 */
export const USAGE_NOTICE_VERSION = '1.4';

/** "1.10" depois de "1.9": compara número a número. */
function versionAtLeast(seen: string, min: string): boolean {
  const a = seen.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (Number.isNaN(x)) return false;
    if (x !== y) return x > y;
  }
  return true;
}

const KEY = 'librax_policySeen';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Já usava o app e ainda não viu o aviso dos dados de uso (versão 1.4 ou depois). */
export function usageNoticePending(): boolean {
  if (!isOnboarded()) return false;
  const seen = read();
  return seen === null || !versionAtLeast(seen, USAGE_NOTICE_VERSION);
}

/** Viu o aviso (ou aceitou a versão nas boas-vindas). */
export function markPolicySeen(): void {
  try {
    localStorage.setItem(KEY, PRIVACY_POLICY_VERSION);
  } catch {
    /* sem armazenamento: o aviso pode voltar na próxima visita */
  }
}
