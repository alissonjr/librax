/**
 * Como os arquivos do VLibras (player e animações em /vlibras/, scripts/vlibras-assets.mjs) chegam
 * ao app: regra do cache do service worker e ajuste dos servidores do Vite. Usado pelo
 * vite.config.ts; fica aqui para ter teste.
 */

/**
 * Plugin do Workbox para as rotas do VLibras: só guarda o que não é HTML. Um servidor que não
 * acha o arquivo pode responder a página do app com 200 (o Vite faz isso); sem esta regra esse
 * HTML ficaria no cache para sempre no lugar da animação. A função vai como texto para o sw.js
 * gerado: não pode usar nada de fora dela.
 */
export const rejectHtmlPlugin = {
  cacheWillUpdate: async ({ response }: { response: Response }) =>
    (response.headers.get('content-type') ?? '').includes('text/html') ? null : response,
};

/**
 * Endereço de animação com caractere reservado codificado (o app pede ACORDAR&DESPERTAR como
 * ACORDAR%26DESPERTAR, com encodeURIComponent). Os servidores do Vite decodificam o caminho com
 * decodeURI, que mantém o %26, então não acham o arquivo e respondem o index.html. Devolve o
 * endereço com esses caracteres decodificados (o arquivo no disco tem o nome da glosa), ou
 * `null` quando não há o que mudar. Em produção o S3 decodifica o caminho inteiro e acha a chave.
 * Barra, "?", "#" e "%" continuam codificados: não mudam o sentido do caminho.
 */
export function decodeSignUrl(url: string): string | null {
  const q = url.indexOf('?');
  const path = q < 0 ? url : url.slice(0, q);
  if (!path.startsWith('/vlibras/sinais/')) return null;
  const decoded = path.replace(/%(2[46BC]|3[ABD]|40)/gi, (code) => decodeURIComponent(code));
  return decoded === path ? null : decoded + (q < 0 ? '' : url.slice(q));
}
