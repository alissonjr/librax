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
export const PRIVACY_POLICY_VERSION = '1.4';

const KEY = 'librax_policySeen';

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Já usava o app e ainda não viu o aviso desta versão. */
export function usageNoticePending(): boolean {
  return isOnboarded() && read() !== PRIVACY_POLICY_VERSION;
}

/** Viu o aviso (ou aceitou a versão nas boas-vindas). */
export function markPolicySeen(): void {
  try {
    localStorage.setItem(KEY, PRIVACY_POLICY_VERSION);
  } catch {
    /* sem armazenamento: o aviso pode voltar na próxima visita */
  }
}
