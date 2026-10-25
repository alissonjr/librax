import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

/**
 * Landing publica (apps/landing): site estatico no dominio raiz (apex), com o www redirecionando
 * para o apex. O app fica em app.<dominio>, no CloudFront dele, sem mudar caminho nem escopo do PWA.
 *
 * Paginas: / (portugues), /en/ e /es/. A pagina raiz tem um script inline pequeno que leva ao
 * idioma do navegador; a CSP libera esse script pelo hash (sha256), sem 'unsafe-inline'.
 */

/** Paginas geradas pelo build da landing (dist/), uma por idioma. */
export const LANDING_PAGES = ['index.html', 'en/index.html', 'es/index.html'];

/**
 * Hash do script inline da raiz no ultimo build conhecido. So vale quando o synth roda sem o
 * build da landing (o synth avisa). Para atualizar: `npm run landing:build` e `npm run landing:hash`
 * (em infra) e copiar a saida aqui.
 */
export const LANDING_INLINE_SCRIPT_HASHES = ['sha256-//4Ffw7TmvedHAP0d8Dat9CE8rP7od5JdbMBrCAMzUA='];

/** Cache-Control das paginas e dos arquivos sem hash no nome (icones, fontes, imagens). */
export const LANDING_SHORT_CACHE = 'public, max-age=300';

/** A landing nao usa camera nem outro recurso do aparelho. */
export const LANDING_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()';

/**
 * Hashes (sha256, base64) dos <script> inline executaveis de um HTML. Fica de fora o que tem
 * `src` e o que nao e JavaScript (ex.: application/ld+json, que o navegador nao executa).
 * Mesma conta em scripts/landing.mjs (o teste confere as duas).
 */
export function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const [, attrs, body] = m;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1].toLowerCase();
    if (type && type !== 'module' && type !== 'text/javascript') continue;
    hashes.push(`sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`);
  }
  return hashes;
}

/**
 * Hashes da CSP da landing. Com o build (dist/index.html) a conta sai dele; sem o build, vale o
 * hash gravado acima e `fromBuild` fica false (a stack avisa no synth).
 */
export function landingScriptHashes(distDir: string): { hashes: string[]; fromBuild: boolean } {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    return { hashes: [...LANDING_INLINE_SCRIPT_HASHES], fromBuild: false };
  }
  const hashes = new Set<string>();
  for (const page of LANDING_PAGES) {
    const file = path.join(distDir, page);
    if (existsSync(file)) for (const h of inlineScriptHashes(readFileSync(file, 'utf8'))) hashes.add(h);
  }
  return { hashes: [...hashes].sort(), fromBuild: true };
}

/**
 * CSP da landing: tudo da propria origem, script inline so pelo hash. Estilo inline liberado
 * porque o HTML usa atributos style com variaveis CSS (--i, --w). Nao pode ser emoldurada.
 */
export function landingCsp(scriptHashes: string[]): string {
  const directives: Array<[string, string[]]> = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", ...scriptHashes.map((h) => `'${h}'`)]],
    ['connect-src', ["'self'"]],
    ['img-src', ["'self'", 'data:']],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['font-src', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['upgrade-insecure-requests', []],
  ];
  return directives.map(([name, values]) => (values.length ? `${name} ${values.join(' ')}` : name)).join('; ');
}

/**
 * CloudFront Function (viewer-request) da landing:
 * - www (e outros nomes de `redirectHosts`) -> 301 para o apex, mantendo caminho e query;
 * - /app e /app/... -> 301 para o app (o link padrao da landing, APP_URL=/app/, continua valendo);
 * - pasta (/, /en/, /es/) -> <pasta>/index.html;
 * - caminho sem extensao e sem barra (/en) -> 301 para /en/.
 * @param canonicalHost  nome do apex (ex.: librax.com.br)
 * @param appOrigin      origem do app (https://app.<dominio>); pode ser token do CDK
 */
export function landingRequestFunction(canonicalHost: string, redirectHosts: string[], appOrigin: string): string {
  return `var CANONICAL = ${JSON.stringify(canonicalHost)};
var REDIRECT_HOSTS = ${JSON.stringify(redirectHosts.map((h) => h.toLowerCase()))};
var APP_ORIGIN = '${appOrigin}';

function query(qs) {
  var parts = [];
  for (var name in qs) {
    var item = qs[name];
    var values = item.multiValue ? item.multiValue : [item];
    for (var i = 0; i < values.length; i++) {
      parts.push(values[i].value === '' ? name : name + '=' + values[i].value);
    }
  }
  return parts.length ? '?' + parts.join('&') : '';
}

function redirect(location) {
  return { statusCode: 301, statusDescription: 'Moved Permanently', headers: { location: { value: location } } };
}

function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var host = request.headers.host ? request.headers.host.value.toLowerCase() : '';
  if (REDIRECT_HOSTS.indexOf(host) !== -1) {
    return redirect('https://' + CANONICAL + uri + query(request.querystring));
  }
  if (uri === '/app' || uri.indexOf('/app/') === 0) {
    return redirect(APP_ORIGIN + '/' + uri.slice(5) + query(request.querystring));
  }
  if (uri.charAt(uri.length - 1) === '/') {
    request.uri = uri + 'index.html';
    return request;
  }
  var last = uri.split('/').pop();
  if (last.indexOf('.') === -1) {
    return redirect(uri + '/' + query(request.querystring));
  }
  return request;
}`;
}
