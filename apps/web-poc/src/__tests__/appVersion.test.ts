import { describe, expect, it } from 'vitest';
import { formatVersion, versionId } from '../lib/appVersion';

describe('versão do build', () => {
  // Data sem Z: os valores são sempre os do fuso do aparelho de teste.
  const build = { builtAt: '2026-10-25T08:05:00', commit: 'abc1234' };
  it.each(['pt-BR', 'es'] as const)('mostra data, hora e commit em %s', lang => {
    expect(formatVersion(build, lang)).toBe('25/10/2026 08:05 (abc1234)');
  });
  it('mostra uma data sem ambiguidade em inglês', () => {
    expect(formatVersion(build, 'en')).toBe('2026-10-25 08:05 (abc1234)');
  });
  it('preserva data e hora sem git e tolera metadados ausentes', () => {
    expect(formatVersion({ ...build, commit: '' }, 'pt-BR')).toBe('25/10/2026 08:05');
    expect(formatVersion({ ...build, builtAt: 'inválida' }, 'pt-BR')).toBe('abc1234');
    expect(formatVersion({ builtAt: '', commit: '' }, 'en')).toBe('');
  });
  it('distingue builds do mesmo commit', () => {
    expect(versionId(build)).not.toBe(versionId({ ...build, builtAt: '2026-10-25T09:00:00' }));
  });
});
