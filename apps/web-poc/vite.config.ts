import { defineConfig, type Plugin, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { tokens } from './src/styles/tokens';
import { decodeSignUrl, rejectHtmlPlugin } from './src/lib/vlibrasServing';

// Cor do tema do PWA: token bg.canvas do modo claro. O index.html recebe o mesmo valor
// (e o do modo escuro) pelo plugin abaixo, para não haver cor escrita à mão.
const THEME_COLOR = tokens['theme.light.bg.canvas'];
const THEME_COLOR_DARK = tokens['theme.dark.bg.canvas'];
// Tela de abertura do app instalado (Android): o grafite do ícone, com a seta tangerina no centro
const SPLASH_COLOR = tokens['brand.icon.bg'];

// Valor de um token em CSS, para o HTML que pinta antes de o tokens.css chegar (tela de abertura).
// Lista de fontes vira "A, B, C" e curva vira cubic-bezier(...); token que não existe quebra o build.
function tokenCss(name: string): string {
  const value = (tokens as Record<string, unknown>)[name];
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) return `cubic-bezier(${value.join(', ')})`;
  if (Array.isArray(value)) return value.join(', ');
  throw new Error(`index.html: token desconhecido ou sem valor CSS: ${name}`);
}

// __LX_THEME_LIGHT__/__LX_THEME_DARK__ (theme-color) e __LX_TOKEN(nome.do.token)__ (CSS inline da
// tela de abertura, que não pode esperar o JS) viram o valor do token.
const themeColorHtml = (): Plugin => ({
  name: 'librax-theme-color',
  transformIndexHtml: (html) =>
    html
      .replaceAll('__LX_THEME_LIGHT__', THEME_COLOR)
      .replaceAll('__LX_THEME_DARK__', THEME_COLOR_DARK)
      .replace(/__LX_TOKEN\(([^)]+)\)__/g, (_, name: string) => tokenCss(name)),
});

// Arquivos de ML em /ml/<versao>/ (scripts/ml-assets.mjs). O WASM precisa de
// Content-Type application/wasm para o navegador compilar enquanto baixa; o nome tem a versão,
// então o cache pode ser imutável. Vale no dev e no preview; em produção quem define é o
// CloudFront/S3 (ver README).
const mlHeaders = (): Plugin => {
  const middleware = (req: { url?: string }, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path.startsWith('/ml/')) {
      if (path.endsWith('.wasm')) res.setHeader('Content-Type', 'application/wasm');
      else if (path.endsWith('.task') || path.endsWith('.bin')) res.setHeader('Content-Type', 'application/octet-stream');
      if (/^\/ml\/\d+\.\d+\.\d+\//.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    next();
  };
  return {
    name: 'librax-ml-headers',
    configureServer: (server) => { server.middlewares.use(middleware); },
    configurePreviewServer: (server) => { server.middlewares.use(middleware); },
  };
};

// Animação de glosa com "&" (ACORDAR&DESPERTAR): o app pede com %26 e o Vite não decodifica
// isso, então responderia o index.html. Troca pelo caractere antes de o Vite procurar o arquivo
// (lib/vlibrasServing.ts). Vale no dev e no preview; em produção o S3 já resolve.
const vlibrasSignPaths = (): Plugin => {
  const middleware = (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = decodeSignUrl(req.url ?? '');
    if (url) req.url = url;
    next();
  };
  return {
    name: 'librax-vlibras-sign-paths',
    configureServer: (server) => { server.middlewares.use(middleware); },
    configurePreviewServer: (server) => { server.middlewares.use(middleware); },
  };
};

// Página treino-video.html (só no servidor de desenvolvimento): serve os vídeos baixados por
// ml-training/video/baixar.py (e o modelo de pose do modo sinais) e grava os landmarks que a página
// extrai. Nada disso vai para o build.
const TREINO_DATA = resolve(__dirname, '../../ml-training/data');
const treinoVideo = (): Plugin => ({
  name: 'librax-treino-video',
  configureServer(server) {
    server.middlewares.use('/treino-dados', (req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      const m = /^\/(fontes(?:_sinais)?\.json|videos\/[\w.-]+|modelos\/[\w.-]+\.task|(?:landmarks|landmarks_sinais)\/[\w.-]+\.json|rotulos\/[\w.-]+\.json)$/.exec(path);
      if (!m) return next();
      const file = resolve(TREINO_DATA, m[1]);
      if (req.method === 'PUT' && m[1].startsWith('landmarks')) {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          mkdirSync(resolve(file, '..'), { recursive: true });
          writeFileSync(file, Buffer.concat(chunks));
          res.statusCode = 204;
          res.end();
        });
        return;
      }
      if (!existsSync(file)) {
        res.statusCode = 404;
        return res.end();
      }
      const size = statSync(file).size;
      const type = file.endsWith('.json') ? 'application/json'
        : file.endsWith('.task') ? 'application/octet-stream'
        : file.endsWith('.webm') ? 'video/webm' : 'video/mp4';
      res.setHeader('Content-Type', type);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      // O <video> pede pedaços (Range): sem isso o Chrome não deixa buscar posição no vídeo
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        res.statusCode = 206;
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        createReadStream(file, { start, end }).pipe(res);
        return;
      }
      res.setHeader('Content-Length', String(size));
      createReadStream(file).pipe(res);
    });
  },
});

// npm run dev:celular: imprime os endereços da página de teste e da coleta na rede local
const printPhoneUrl = (): Plugin => ({
  name: 'librax-print-phone-url',
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      const address = server.httpServer?.address();
      const port = typeof address === 'object' && address ? address.port : server.config.server.port;
      // Pontes do Docker e de VMs não chegam ao celular: ficam de fora
      const ips = Object.entries(networkInterfaces())
        .filter(([name]) => !/^(docker|br-|veth|virbr|vboxnet|vmnet|cni|flannel|tailscale|zt)/.test(name))
        .flatMap(([, list]) => list ?? [])
        .filter((n) => n.family === 'IPv4' && !n.internal)
        .map((n) => n.address)
        .sort((a, b) => Number(!/^(192\.168|10)\./.test(a)) - Number(!/^(192\.168|10)\./.test(b)));
      setTimeout(() => {
        console.log('\n  Abra no celular (mesmo Wi-Fi), aceite o aviso de certificado e permita a câmera:');
        if (ips.length === 0) console.log('  (nenhum IP de rede local encontrado: o computador está no Wi-Fi?)');
        for (const ip of ips) {
          console.log(`  -> https://${ip}:${port}/teste-camera.html   (teste da câmera)`);
          console.log(`     https://${ip}:${port}/coleta.html         (coleta de letras)`);
        }
        console.log('');
      }, 50);
    });
  },
});

// npm run dev:local: contra o ambiente local que simula a AWS (docs/ambiente-local.md). As VITE_*
// vêm da pasta gerada pelo bootstrap (nunca do .env.local, que é o da AWS de verdade) e /api vai
// para a API local.
const LOCAL_ENV_DIR = resolve(__dirname, '../../infra/local/.data/env/app');
const LOCAL_API = 'http://127.0.0.1:5332';

export default defineConfig(({ mode }) => {
  const celular = mode === 'celular';
  const local = mode === 'ambiente-local';
  const extraPlugins: PluginOption[] = celular ? [basicSsl({ name: 'librax-dev' }), printPhoneUrl()] : [];
  if (local && !existsSync(resolve(LOCAL_ENV_DIR, '.env'))) {
    throw new Error('Ambiente local sem bootstrap: rode `npm run local:up` em services/api antes do dev:local.');
  }

  return {
    ...(local ? { envDir: LOCAL_ENV_DIR } : {}),
    // SPA: o servidor de desenvolvimento e o "vite preview" respondem index.html para qualquer rota
    // do app (/aprender, /licao/u1-l1...), então recarregar numa URL funciona. Em produção o
    // service worker faz o mesmo (navigateFallback abaixo) e o CDN precisa responder index.html
    // para rotas que não são arquivo. As páginas avulsas (teste-camera.html, coleta.html) existem
    // como arquivo e são servidas antes do fallback.
    appType: 'spa',
    // Modo celular: HTTPS (a câmera exige contexto seguro) e aberto para a rede local.
    // allowedHosts libera o endereço do túnel (alternativa do README quando o certificado trava).
    // Modo local: porta fixa (5300 é do dono) e /api para a API local.
    server: celular
      ? { host: '0.0.0.0', port: 5174, allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'] }
      : local
        ? { host: '127.0.0.1', port: 5320, strictPort: true, proxy: { '/api': { target: LOCAL_API } } }
        : undefined,
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          'teste-camera': resolve(__dirname, 'teste-camera.html'),
          coleta: resolve(__dirname, 'coleta.html'),
        },
      },
    },
    resolve: {
      alias: {
        '@domain': resolve(__dirname, '../../services/api/src/domain'),
        '@apilib': resolve(__dirname, '../../services/api/src/lib'),
        '@usecases': resolve(__dirname, '../../services/api/src/usecases'),
      },
    },
    plugins: [
      react(),
      themeColorHtml(),
      mlHeaders(),
      vlibrasSignPaths(),
      treinoVideo(),
      ...extraPlugins,
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2,m4a}'],
          // ML fora do precache: o WASM (13 MB) e o modelo (7,8 MB) estouram o limite de 2 MB
          // e só quem usa a câmera precisa deles. Entram no cache em runtime (abaixo).
          globIgnores: ['ml/**', 'vlibras/v*/**', 'vlibras/sinais/**'],
          // Navegação para qualquer rota do app abre o index.html do precache (funciona offline e ao
          // recarregar). Ficam de fora a página do avatar (iframe próprio), o que não é tela do app e
          // as páginas avulsas da câmera (teste da câmera W0 e coleta), que têm HTML próprio.
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [
            /^\/vlibras\//, /^\/api\//, /^\/content\//, /^\/ml\//, /^\/teste-camera/, /^\/coleta/,
          ],
          runtimeCaching: [
            // WASM e modelo do MediaPipe: a versão está na URL (/ml/1.1.1/...), então o que foi
            // baixado uma vez vale para sempre e a câmera funciona offline depois do primeiro uso.
            // Versões antigas saem pela expiração.
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/ml\/\d+\.\d+\.\d+\//.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'librax-ml-v1',
                expiration: { maxEntries: 8 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Classificador treinado (model.json + weights.bin): a URL não tem versão, então usa o
            // guardado e atualiza por trás. Um 404 (ainda sem modelo) não entra no cache.
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ml/classifier/'),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'librax-classifier-v1',
                expiration: { maxEntries: 4 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Modelo dos sinais com movimento (/ml/sinais/): mesma regra do classificador das letras
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/ml/sinais/'),
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'librax-sinais-v1',
                expiration: { maxEntries: 4 },
                cacheableResponse: { statuses: [200] },
              },
            },
            {
              urlPattern: /\.mp4$/,
              handler: 'CacheFirst',
              options: { cacheName: 'librax-videos-v1' },
            },
            // Avatar VLibras servido pelo próprio app (scripts/vlibras-assets.mjs). Nada entra no
            // precache: só guarda o que já foi usado. Animações: cerca de 23 KB cada (máx. 61 KB);
            // as 252 glosas do curso somam ~6 MB, então 400 entradas cabem com folga na cota do
            // Safari e do Chrome. A versão está na pasta, então o guardado vale para sempre.
            // HTML com 200 (a página do app no lugar de um arquivo que não existe) não entra.
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/vlibras/sinais/'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'librax-vlibras-sinais-v2',
                expiration: { maxEntries: 400 },
                cacheableResponse: { statuses: [200] },
                plugins: [rejectHtmlPlugin],
              },
            },
            // Motor do player (~20 MB: dados do Unity 17 MB + wasm 3 MB), em /vlibras/v<versão>/.
            // Versões antigas saem pela expiração.
            {
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /^\/vlibras\/v\d/.test(url.pathname),
              handler: 'CacheFirst',
              options: {
                cacheName: 'librax-vlibras-player-v2',
                expiration: { maxEntries: 12 },
                cacheableResponse: { statuses: [200] },
                plugins: [rejectHtmlPlugin],
              },
            },
          ],
        },
        // Ícones gerados por tools/pwa/build-icons.mjs (npm run pwa-icons) com as cores dos tokens
        manifest: {
          id: '/',
          name: 'Librax: aprenda Libras',
          short_name: 'Librax',
          description: 'Aprenda Libras no celular, com a câmera mostrando o sinal da sua mão.',
          lang: 'pt-BR',
          dir: 'ltr',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          theme_color: THEME_COLOR,
          background_color: SPLASH_COLOR,
          categories: ['education'],
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
      }),
    ],
  };
});
