import { describe, it, expect } from 'vitest';
import config from '../../vite.config.ts?raw';

describe('service worker do app', () => {
  it('não abre a trilha no lugar do painel (/admin)', () => {
    const denylist = config.slice(config.indexOf('navigateFallbackDenylist'), config.indexOf('runtimeCaching'));
    expect(denylist).toContain('/^\\/admin(\\/|$)/');
  });
});
