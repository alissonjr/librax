import { SYMBOLS } from '@app/icons/symbols';

/** Mesmos Material Symbols Rounded do app (apps/web-poc/src/icons/symbols.ts, gerado). */
export function Icon({ name, label, size = '1.25em' }: { name: string; label?: string; size?: string }) {
  const symbol = SYMBOLS[name];
  if (!symbol) return null;
  return (
    <svg
      className="icon"
      viewBox="0 -960 960 960"
      width={size}
      height={size}
      fill="currentColor"
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={symbol.outline} />
    </svg>
  );
}
