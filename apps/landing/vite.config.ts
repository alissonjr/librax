import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { headLinks } from './src/render';
import { isLocale } from './src/locale';

const ROOT = __dirname;
const PAGES = { 'pt-BR': 'index.html', en: 'en/index.html', es: 'es/index.html' } as const;

/**
 * As páginas são geradas de src/render.ts (scripts/gerar-paginas.ts). No dev, cada mudança em
 * src/ (textos, números, render) gera os HTML de novo e o Vite recarrega a página.
 */
function pages(): Plugin {
  let server: ViteDevServer | null = null;
  const write = async () => {
    if (!server) return;
    const render = (await server.ssrLoadModule('/src/render.ts')) as typeof import('./src/render');
    for (const [locale, file] of Object.entries(PAGES)) {
      const out = resolve(ROOT, file);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, render.renderPage(locale as keyof typeof PAGES));
    }
  };
  return {
    name: 'librax-landing-pages',
    apply: 'serve',
    configureServer(s) {
      server = s;
      const isSource = (f: string) => f.startsWith(resolve(ROOT, 'src')) && !f.endsWith('main.ts') && !f.endsWith('.css');
      s.watcher.on('change', (f) => {
        if (!isSource(f)) return;
        for (const mod of s.moduleGraph.idToModuleMap.values()) {
          if (mod.ssrModule) s.moduleGraph.invalidateModule(mod);
        }
        write().catch((e) => s.config.logger.error(String(e)));
      });
      return () => write().catch((e) => s.config.logger.error(String(e)));
    },
  };
}

/** Troca o marcador <!--lx:links:<idioma>--> pelos links canonical e hreflang (depois do Vite). */
function links(): Plugin {
  return {
    name: 'librax-landing-links',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(/<!--lx:links:([\w-]+)-->/, (m, l: string) => (isLocale(l) ? headLinks(l, process.env.SITE_ORIGIN ?? '') : m)),
    },
  };
}

export default defineConfig({
  // Landing na raiz do domínio; o app fica em APP_URL (src/config.ts)
  base: '/',
  // A mão em 3D (retargeting e modelo) é a mesma do app: fica em apps/web-poc/src/mao3d e entra aqui
  // por caminho relativo. O three vem sempre do node_modules da landing (mesma versão do app).
  resolve: { dedupe: ['three'] },
  server: {
    port: 5198,
    strictPort: true,
    host: '127.0.0.1',
    fs: { allow: [ROOT, resolve(ROOT, '../web-poc/src/mao3d')] },
  },
  preview: { port: 5199, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    rollupOptions: {
      input: Object.values(PAGES).map((f) => resolve(ROOT, f)),
    },
  },
  plugins: [pages(), links()],
});
