/**
 * Cabecalhos de seguranca do app web servido pelo CloudFront (plano mobile web, decisao 14).
 *
 * Tudo na mesma origem (`/`, `/content/`, `/ml/`, `/api/`), entao a CSP parte de 'self'.
 * As excecoes abaixo existem porque o app ainda usa arquivos de terceiros; cada uma sai
 * quando o arquivo passar a ser servido por nos:
 * - MediaPipe: WASM e loader no jsDelivr e modelo no storage.googleapis.com (plano 1.2 item 3;
 *   destino: /ml/<versao>/);
 * - videos de referencia de sinais em dicionarios publicos (destino: /content/);
 * - VLibras: o player oficial vem de vlibras.gov.br (redireciona para o jsDelivr) e as
 *   animacoes de dicionario2.vlibras.gov.br. O service worker do app guarda essas respostas,
 *   por isso tambem entram no connect-src da pagina principal.
 *
 * A pagina /vlibras/player.html roda o Unity (blob:, eval e script inline) e recebe uma CSP
 * propria, mais aberta, so para aquele caminho.
 */

/** Hosts de midia externos usados hoje pelo conteudo (videos de referencia). */
export const EXTERNAL_MEDIA_HOSTS = [
  'https://dicionario.ines.gov.br',
  'https://videos.nals.cce.ufsc.br',
  'https://media.spreadthesign.com',
];

/** Arquivos do MediaPipe ainda em CDN de terceiros (useCameraRecognizer.ts). */
export const EXTERNAL_ML_HOSTS = ['https://cdn.jsdelivr.net', 'https://storage.googleapis.com'];

/** Player e animacoes do VLibras (src/lib/vlibras.ts e public/vlibras/player.html). */
export const VLIBRAS_HOSTS = ['https://vlibras.gov.br', 'https://www.vlibras.gov.br', 'https://dicionario2.vlibras.gov.br'];

/** Recursos do navegador: so a camera, e so na propria origem (reconhecimento de sinais). */
export const PERMISSIONS_POLICY =
  'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()';

/** Cache-Control dos arquivos que precisam ser revalidados a cada abertura (index.html, sw.js). */
export const NO_CACHE = 'no-cache';
/** Cache-Control dos arquivos com hash no nome (/assets/) e versionados (/ml/<versao>/). */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

const join = (directives: Record<string, string[]>): string =>
  Object.entries(directives)
    .map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name))
    .join('; ');

/**
 * CSP do app.
 * @param authOrigin  origem do dominio do Cognito (https://auth.<dominio>), usada pelo
 *                    Amplify na troca do code por tokens (OAuth com PKCE)
 * @param cognitoIdpOrigin  https://cognito-idp.<regiao>.amazonaws.com (login SRP e refresh)
 */
export function appCsp(authOrigin: string, cognitoIdpOrigin: string): string {
  return join({
    'default-src': ["'self'"],
    // wasm-unsafe-eval: compilar o WASM do MediaPipe; sem 'unsafe-eval' nem inline
    'script-src': ["'self'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': [
      "'self'",
      cognitoIdpOrigin,
      authOrigin,
      ...EXTERNAL_ML_HOSTS,
      ...VLIBRAS_HOSTS,
      ...EXTERNAL_MEDIA_HOSTS,
    ],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:', ...EXTERNAL_MEDIA_HOSTS],
    // React aplica estilo por atributo; o app nao tem <style> inline de terceiros
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'"],
    'frame-src': ["'self'"],
    'frame-ancestors': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': [],
  });
}

/** CSP da pagina do avatar VLibras (/vlibras/*), que roda o build WebGL do Unity. */
export function vlibrasCsp(): string {
  return join({
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:', 'https://cdn.jsdelivr.net', ...VLIBRAS_HOSTS],
    'worker-src': ["'self'", 'blob:'],
    'connect-src': ["'self'", 'blob:', 'data:', 'https://cdn.jsdelivr.net', ...VLIBRAS_HOSTS],
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:'],
    'style-src': ["'self'", "'unsafe-inline'"],
    'frame-ancestors': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
  });
}

/**
 * CloudFront Function (viewer-request) do comportamento padrao: rotas do app sem extensao
 * (/licao/u1-l1, /convite/ABC123, /auth/callback) recebem o index.html, para o roteador do
 * app resolver. Arquivos com extensao seguem para o bucket como estao.
 */
export const SPA_REWRITE_FUNCTION = `function handler(event) {
  var request = event.request;
  var last = request.uri.split('/').pop();
  if (last === '' || last.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}`;

/**
 * CloudFront Function (viewer-response) dos caminhos *.wasm: garante `application/wasm`,
 * que o WebAssembly.compileStreaming exige, mesmo que o arquivo suba com outro tipo.
 */
export const WASM_CONTENT_TYPE_FUNCTION = `function handler(event) {
  var response = event.response;
  response.headers['content-type'] = { value: 'application/wasm' };
  return response;
}`;
