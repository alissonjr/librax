/**
 * Digital Asset Links do app Android (apps/android-twa, Trusted Web Activity).
 *
 * O Chrome so abre o app Android em tela cheia (sem a barra de endereco) quando o site declara, em
 * https://app.<dominio>/.well-known/assetlinks.json, que confia no pacote assinado com aquele
 * certificado. Sem a declaracao o app continua funcionando, mas com a barra de endereco no topo.
 *
 * O arquivo nao fica no bucket do app: o upload do app usa `aws s3 sync --delete`, que apagaria
 * qualquer arquivo que nao veio do build. Ele sai de uma CloudFront Function (viewer-request) que
 * devolve o JSON pronto, gerado no synth a partir do contexto:
 * - `librax:androidPackageName`: id do pacote (padrao br.com.librax.app, o mesmo do
 *   apps/android-twa/gradle.properties);
 * - `librax:androidCertFingerprints`: SHA-256 dos certificados, separados por virgula. Com a
 *   assinatura de apps do Google Play entram os dois: o da chave de upload e o da chave de
 *   assinatura do app (Play Console > Integridade do app > Assinatura de apps).
 * Sem impressao digital o arquivo sai como `[]` (lista valida, sem nenhuma declaracao).
 */

/** Pacote padrao do app Android (apps/android-twa/gradle.properties, librax.applicationId). */
export const DEFAULT_ANDROID_PACKAGE = 'br.com.librax.app';

/** Cache curto: trocar a chave aparece em minutos, e o Google le o arquivo poucas vezes. */
export const ASSETLINKS_CACHE = 'public, max-age=300';

export const ASSETLINKS_PATH = '/.well-known/assetlinks.json';

const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Confere o id do pacote Android (mesma regra do applicationId do Gradle). */
export function validPackageName(name: string): boolean {
  return PACKAGE_RE.test(name);
}

/**
 * Normaliza uma impressao digital SHA-256 para o formato do assetlinks (AA:BB:...:FF, maiusculas).
 * Aceita com ou sem os dois-pontos, como o keytool e o Play Console mostram. Retorna null se nao for
 * um SHA-256 (32 bytes).
 */
export function normalizeFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/[\s:]/g, '').toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(hex)) return null;
  const value = hex.match(/.{2}/g)!.join(':');
  return FINGERPRINT_RE.test(value) ? value : null;
}

export interface AssetStatement {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}

/** Conteudo do assetlinks.json: uma declaracao com todas as impressoes, ou `[]` sem nenhuma. */
export function assetLinks(packageName: string, fingerprints: string[]): AssetStatement[] {
  if (fingerprints.length === 0) return [];
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

/**
 * CloudFront Function (viewer-request) de /.well-known/assetlinks.json: responde direto da borda,
 * sem ir ao bucket, com `application/json` e cache curto. Sem redirecionamento (o Google nao segue).
 */
export function assetLinksFunction(statements: AssetStatement[]): string {
  const body = JSON.stringify(JSON.stringify(statements));
  return `function handler(event) {
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: {
      'content-type': { value: 'application/json' },
      'cache-control': { value: '${ASSETLINKS_CACHE}' },
      'x-content-type-options': { value: 'nosniff' }
    },
    body: { encoding: 'text', data: ${body} }
  };
}`;
}
