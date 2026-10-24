/**
 * Quem responde pelo Librax nos textos jurídicos (Política de Privacidade e Termos de Uso).
 *
 * Único lugar dos dados do controlador: os textos (privacidade.md e termos.md) usam as chaves entre
 * chaves duplas ({{nome}}, {{documento}}, {{email}}, {{foro}}) e a página troca pelos valores abaixo.
 * Enquanto o responsável não estiver definido, ficam os marcadores entre colchetes, fáceis de achar.
 * Ao preencher, suba a versão e a data de vigência no topo dos dois textos.
 */
export const RESPONSAVEL = {
  /** Pessoa ou empresa que controla os dados (o "controlador" da LGPD). */
  nome: '[NOME DO RESPONSÁVEL]',
  documento: '[CNPJ OU CPF]',
  /** Canal do titular de dados: pedidos de acesso, correção e exclusão. */
  email: '[E-MAIL DE CONTATO]',
  /** Comarca do foro dos Termos de Uso. */
  foro: '[CIDADE/UF PARA O FORO]',
} as const;

export type ResponsavelKey = keyof typeof RESPONSAVEL;

/** Marcadores ainda não preenchidos (os que continuam entre colchetes). */
export function pendingResponsavel(): ResponsavelKey[] {
  return (Object.keys(RESPONSAVEL) as ResponsavelKey[]).filter(k => /^\[.*\]$/.test(RESPONSAVEL[k]));
}
