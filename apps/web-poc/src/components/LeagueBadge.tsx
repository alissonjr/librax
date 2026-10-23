import type { TierId } from '../lib/leagueLocal';
import { TIER_NAMES } from '../lib/leagueLocal';
import { useT } from '../i18n';

/**
 * Insígnia de liga (design system 4.4): a cor nunca vem sozinha. Cada liga tem forma própria
 * (círculo, escudo, escudo com coroa, hexágono, octógono, estrela, diamante facetado), contorno
 * de 2 px no token `league.<liga>.edge` e o nome sempre escrito ao lado ou no rótulo acessível.
 */

function polygon(sides: number, r: number, rotationDeg: number, cx = 24, cy = 24): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function star(points: number, outer: number, inner: number, cx = 24, cy = 25): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

const SHIELD = 'M24 4 L41 10 V24 C41 34 33 41 24 44 C15 41 7 34 7 24 V10 Z';
const CROWN = 'M10 15 L10 4 L17 9.5 L24 2.5 L31 9.5 L38 4 L38 15 Z';
const CROWN_SHIELD = 'M8 16 H40 V28 C40 37 33 43 24 46 C15 43 8 37 8 28 Z';
const DIAMOND = 'M14 6 H34 L44 18 L24 44 L4 18 Z';
const DIAMOND_FACETS = 'M4 18 H44 M14 6 L19 18 L24 44 M34 6 L29 18 L24 44 M19 18 L24 6 L29 18';

function Shape({ tier }: { tier: TierId }) {
  switch (tier) {
    case 'bronze':
      return <circle cx="24" cy="24" r="20" />;
    case 'prata':
      return <path d={SHIELD} />;
    case 'ouro':
      return (
        <>
          <path d={CROWN} />
          <path d={CROWN_SHIELD} />
        </>
      );
    case 'safira':
      return <polygon points={polygon(6, 21, -90)} />;
    case 'rubi':
      return <polygon points={polygon(8, 21, -67.5)} />;
    case 'ametista':
      return <polygon points={star(5, 22, 10)} />;
    case 'diamante':
      return (
        <>
          <path d={DIAMOND} />
          <path d={DIAMOND_FACETS} fill="none" className="league-badge-facets" />
        </>
      );
  }
}

interface Props {
  tier: TierId;
  /** Tamanho em px (64 no cabeçalho, 96 no sheet, 32 a 40 em listas). */
  size?: number;
  /** Sem rótulo, a insígnia é decorativa (o nome já está escrito ao lado). */
  labelled?: boolean;
  className?: string;
}

export function LeagueBadge({ tier, size = 48, labelled = false, className }: Props) {
  const { t } = useT();
  const label = t('league.tierName', { name: TIER_NAMES[tier] });
  return (
    <svg
      className={['league-badge', `league-badge--${tier}`, className ?? ''].filter(Boolean).join(' ')}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      <Shape tier={tier} />
    </svg>
  );
}
