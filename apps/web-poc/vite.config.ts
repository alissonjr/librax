import { defineConfig, type Plugin, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { networkInterfaces } from 'os';
import { tokens } from './src/styles/tokens';

// Cor do tema do PWA: token bg.canvas do modo claro. O index.html recebe o mesmo valor
// (e o do modo escuro) pelo plugin abaixo, para não haver cor escrita à mão.
const THEME_COLOR = tokens['theme.light.bg.canvas'];
const THEME_COLOR_DARK = tokens['theme.dark.bg.canvas'];

const themeColorHtml = (): Plugin => ({
  name: 'librax-theme-color',
  transformIndexHtml: (html) =>
    html.replaceAll('__LX_THEME_LIGHT__', THEME_COLOR).replaceAll('__LX_THEME_DARK__', THEME_COLOR_DARK),
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

export default defineConfig(({ mode }) => {
  const celular = mode === 'celular';
  const extraPlugins: PluginOption[] = celular ? [basicSsl({ name: 'librax-dev' }), printPhoneUrl()] : [];

  return {
    // Modo celular: HTTPS (a câmera exige contexto seguro) e aberto para a rede local.
    // allowedHosts libera o endereço do túnel (alternativa do README quando o certificado trava).
    server: celular
      ? { host: '0.0.0.0', port: 5174, allowedHosts: ['.trycloudflare.com', '.ngrok-free.app'] }
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
      ...extraPlugins,
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
          // ML fora do precache: o WASM (13 MB) e o modelo (7,8 MB) estouram o limite de 2 MB
          // e só quem usa a câmera precisa deles. Entram no cache em runtime (abaixo).
          globIgnores: ['ml/**'],
          // Páginas avulsas (teste da câmera, coleta) não caem no index.html
          navigateFallbackDenylist: [/^\/ml\//, /^\/teste-camera/, /^\/coleta/],
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
            {
              urlPattern: /\.mp4$/,
              handler: 'CacheFirst',
              options: { cacheName: 'librax-videos-v1' },
            },
            // Avatar VLibras (src/lib/vlibras.ts). Nada entra no precache: só guarda o que já foi
            // usado. Animações: cerca de 23 KB cada (máx. 61 KB); as 252 glosas do curso somam
            // ~5,7 MB, então 400 entradas cabem com folga na cota do Safari e do Chrome.
            {
              urlPattern: /^https:\/\/dicionario2\.vlibras\.gov\.br\/static\/BUNDLES\//,
              handler: 'CacheFirst',
              options: {
                cacheName: 'librax-vlibras-sinais-v1',
                expiration: { maxEntries: 400 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Motor do player (~20 MB: dados do Unity 17 MB + wasm 3 MB). Os arquivos têm a versão
            // na URL (?v=7.12.2); ao sair versão nova as antigas saem pela expiração.
            {
              urlPattern: /^https:\/\/vlibras\.gov\.br\/app\/unity\/.+\.unityweb/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'librax-vlibras-player-v1',
                expiration: { maxEntries: 6 },
                cacheableResponse: { statuses: [200] },
              },
            },
            // Carregador e manifesto não têm versão na URL: usa o guardado e atualiza por trás.
            {
              urlPattern: /^https:\/\/vlibras\.gov\.br\/app\/unity\/(unity-loader\.js|playerweb\.json)/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'librax-vlibras-loader-v1',
                expiration: { maxEntries: 4 },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
        manifest: {
          name: 'Librax',
          short_name: 'Librax',
          description: 'Aprenda Libras com reconhecimento de gestos',
          theme_color: THEME_COLOR,
          background_color: THEME_COLOR,
          display: 'standalone',
          icons: [
            { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        },
      }),
    ],
  };
});
