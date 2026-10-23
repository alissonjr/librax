import { SYMBOLS, type IconName } from '../icons/symbols';

export type { IconName };

interface IconProps {
  name: IconName;
  /** Variante preenchida (aba ativa, ícones de jogo em destaque). Cai no contorno se não existir. */
  filled?: boolean;
  /** Tamanho em CSS. Padrão: 1.25em, que acompanha o texto ao lado. */
  size?: string;
  className?: string;
  /** Gira continuamente (carregando). Parado quando o sistema pede menos movimento. */
  spin?: boolean;
  /** Texto para leitor de tela. Sem ele o ícone é decorativo (aria-hidden). */
  label?: string;
  style?: React.CSSProperties;
}

/**
 * Ícone Material Symbols Rounded em SVG inline (seção 8 da proposta de design system).
 * A cor vem do `color` do elemento pai (fill="currentColor"), então segue o tema sozinho.
 */
export function Icon({ name, filled = false, size, className, spin = false, label, style }: IconProps) {
  const symbol = SYMBOLS[name];
  const d = (filled && symbol.fill) || symbol.outline;
  const cls = ['icon', spin ? 'icon--spin' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <svg
      className={cls}
      viewBox="0 -960 960 960"
      width={size ?? '1.25em'}
      height={size ?? '1.25em'}
      fill="currentColor"
      style={style}
      focusable="false"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
    >
      <path d={d} />
    </svg>
  );
}
