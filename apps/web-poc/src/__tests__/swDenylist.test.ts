import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('service worker do app', () => {
  it('não abre a trilha no lugar do painel (/admin)', () => {
    const config = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    const denylist = config.slice(config.indexOf('navigateFallbackDenylist'), config.indexOf('runtimeCaching'));
    expect(denylist).toContain('/^\\/admin(\\/|$)/');
  });
});
