import type { Lang } from '../i18n';

/**
 * Versão do app: data e hora do build e o commit curto, gravados no build pelo vite.config.ts
 * (define). Nos testes e em qualquer lugar sem o define, os dois ficam vazios.
 */
export interface BuildInfo {
  /** Momento do build em ISO (UTC); '' quando não há. */
  builtAt: string;
  /** Commit curto (7 caracteres); '' quando o build não tinha git. */
  commit: string;
}

export const BUILD: BuildInfo = {
  builtAt: typeof __LX_BUILD_TIME__ === 'string' ? __LX_BUILD_TIME__ : '',
  commit: typeof __LX_BUILD_COMMIT__ === 'string' ? __LX_BUILD_COMMIT__ : '',
};

/** Identidade do build: muda a cada build publicado (é o que o aviso de atualização compara). */
export function versionId(info: BuildInfo = BUILD): string {
  return `${info.builtAt}|${info.commit}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Versão para a pessoa ler, no fuso do aparelho: "25/10/2026 18:30 (a6618bf)" em português e
 * espanhol, "2026-10-25 18:30 (a6618bf)" em inglês (sem a ambiguidade de dia e mês). Sem commit,
 * só a data; sem data, só o commit; sem nada, ''.
 */
export function formatVersion(info: BuildInfo, lang: Lang): string {
  const date = info.builtAt ? new Date(info.builtAt) : null;
  const valid = date !== null && !Number.isNaN(date.getTime());
  const time = valid ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : '';
  const day = !valid ? ''
    : lang === 'en'
      ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      : `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  const when = valid ? `${day} ${time}` : '';
  if (when && info.commit) return `${when} (${info.commit})`;
  return when || info.commit;
}
