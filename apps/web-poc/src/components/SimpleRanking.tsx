import { useT } from '../i18n';
import '../styles/league.css';

export interface SimpleRow {
  key: string;
  rank: number;
  name: string;
  xp: number;
  isYou: boolean;
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0] ?? '').join('').toUpperCase().slice(0, 2);
}

/**
 * Ranking sem zonas de subir e descer (liga geral e ligas privadas), com o mesmo desenho das
 * linhas da liga da semana. A linha da pessoa fica destacada e é anunciada como "Você".
 */
export function SimpleRanking({ rows, label }: { rows: SimpleRow[]; label: string }) {
  const { t } = useT();
  return (
    <ol className="league-ranking" aria-label={label}>
      {rows.map(row => {
        const name = row.isYou ? `${row.name} (${t('league.you')})` : row.name;
        return (
          <li
            key={row.key}
            className={`league-row league-row--stay${row.isYou ? ' league-row--you' : ''}`}
            aria-current={row.isYou ? 'true' : undefined}
          >
            <span className="sr-only">
              {[t('league.rowPlace', { rank: row.rank }), name, t('league.xp', { xp: row.xp })].join(', ')}
            </span>
            <span className="league-row-rank tabular" aria-hidden="true">{row.rank}</span>
            <span className="league-row-zone" aria-hidden="true" />
            <span className="league-row-avatar" aria-hidden="true">{initials(row.name)}</span>
            <span className="league-row-name" aria-hidden="true">
              <span className="league-row-name-text">{row.name}</span>
              {row.isYou && <span className="league-row-you">{t('league.you')}</span>}
            </span>
            <span className="league-row-xp tabular" aria-hidden="true">{t('league.xp', { xp: row.xp })}</span>
          </li>
        );
      })}
    </ol>
  );
}
