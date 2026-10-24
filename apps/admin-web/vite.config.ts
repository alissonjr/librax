import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync } from 'fs';
import { resolve, sep } from 'path';

/*
 * Painel de administracao (docs/painel-admin.md), publicado em /admin no mesmo CloudFront do app.
 *
 * - Tokens do Traco: importados de apps/web-poc/src/styles/tokens.css (gerado de
 *   docs/design-tokens.json), nunca copiados.
 * - Fontes e favicon: em producao vem do proprio app, na mesma origem (/fonts/*, /favicon.svg).
 *   No dev, este plugin serve os mesmos arquivos de apps/web-poc/public.
 * - Dev com a API de verdade: LIBRAX_API_ORIGIN=https://<dominio> npm run dev (proxy de /api).
 *   Sem AWS: npm run dev:mock (dados de exemplo, sem login).
 * - Ambiente local que simula a AWS (docs/ambiente-local.md): npm run dev:local, porta 5321, com
 *   as VITE_* geradas pelo bootstrap (nunca o .env.local) e /api na API local.
 */

const APP_PUBLIC = resolve(__dirname, '../web-poc/public');

function appPublicInDev(): Plugin {
  return {
    name: 'librax-app-public',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!/^\/(fonts\/[\w.-]+\.woff2|favicon\.svg)$/.test(url)) return next();
        const file = resolve(APP_PUBLIC, `.${url}`);
        if (!file.startsWith(APP_PUBLIC + sep) || !existsSync(file)) return next();
        res.setHeader('Content-Type', url.endsWith('.svg') ? 'image/svg+xml' : 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
  };
}

const apiOrigin = process.env.LIBRAX_API_ORIGIN;
const LOCAL_ENV_DIR = resolve(__dirname, '../../infra/local/.data/env/admin');
const LOCAL_API = 'http://127.0.0.1:5332';

export default defineConfig(({ mode }) => {
  const local = mode === 'ambiente-local';
  if (local && !existsSync(resolve(LOCAL_ENV_DIR, '.env'))) {
    throw new Error('Ambiente local sem bootstrap: rode `npm run local:up` em services/api antes do dev:local.');
  }
  return {
    base: '/admin/',
    ...(local ? { envDir: LOCAL_ENV_DIR } : {}),
    plugins: [react(), appPublicInDev()],
    resolve: {
      alias: { '@app': resolve(__dirname, '../web-poc/src') },
    },
    // 5300 e do dono; o painel usa 5310 (dev), 5311 (preview) e 5321 (ambiente local)
    server: local
      ? { host: '127.0.0.1', port: 5321, strictPort: true, proxy: { '/api': { target: LOCAL_API } } }
      : {
          port: 5310,
          strictPort: true,
          proxy: apiOrigin ? { '/api': { target: apiOrigin, changeOrigin: true, secure: true } } : undefined,
        },
    preview: { port: 5311, strictPort: true },
    build: { outDir: 'dist', sourcemap: true },
  };
});
