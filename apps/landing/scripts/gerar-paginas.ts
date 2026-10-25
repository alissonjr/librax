/*
 * Gera index.html (português), en/index.html e es/index.html a partir de src/render.ts, mais o
 * protótipo da abertura em 3D (prototipo-3d.html).
 * Roda antes do dev e do build (os HTML gerados ficam fora do git). No dev, o plugin do
 * vite.config.ts gera de novo a cada mudança em src/.
 *
 *   npm run paginas
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPage } from '../src/render';
import { LOCALES, localePath } from '../src/locale';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const locale of LOCALES) {
  const file = resolve(RAIZ, `.${localePath(locale)}index.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderPage(locale));
}
// Protótipo da abertura com a mão em 3D (só português; só entra no build com PROTOTIPO_3D=1)
writeFileSync(resolve(RAIZ, 'prototipo-3d.html'), renderPage('pt-BR', { prototipo3d: true }));
console.log(`gerar-paginas: ${LOCALES.length} páginas e o protótipo em 3D`);
