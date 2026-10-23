import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
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

export default defineConfig({
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
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2,m4a}'],
        runtimeCaching: [
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
});
