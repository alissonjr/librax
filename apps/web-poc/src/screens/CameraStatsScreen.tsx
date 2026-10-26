import { useEffect, useMemo, useState } from 'react';
import { useT, type TFunc } from '../i18n';
import { Icon, type IconName } from '../components/Icon';
import { Dialog } from '../components/Dialog';
import {
  buildCameraStatsExport,
  clearCameraStats,
  listCameraStats,
  rankByDifficulty,
  type CameraSignStats,
  type CameraSignSummary,
  type DifficultyLevel,
} from '../lib/cameraStats';

interface Props {
  onBack: () => void;
}

const LEVEL_ICON: Record<DifficultyLevel, IconName> = {
  hard: 'warning',
  attention: 'lightbulb',
  ok: 'check',
};

/**
 * Desempenho da câmera (Configurações): quantas tentativas cada letra e sinal precisou, quantas
 * vezes a pessoa pulou e o que a câmera leu no lugar, do mais difícil para o mais fácil
 * (lib/cameraStats.ts). Serve para decidir os próximos treinos do modelo e revisar descrições.
 */
export function CameraStatsScreen({ onBack }: Props) {
  const { t, lang } = useT();
  // null = lendo o banco local
  const [stats, setStats] = useState<CameraSignStats[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    let alive = true;
    listCameraStats()
      .then(all => { if (alive) setStats(all); })
      .catch(() => { if (alive) setStats([]); });
    return () => { alive = false; };
  }, []);

  const ranked = useMemo(() => rankByDifficulty(stats ?? []), [stats]);
  const totals = useMemo(() => ranked.reduce(
    (acc, s) => ({ successes: acc.successes + s.successes, skips: acc.skips + s.skips }),
    { successes: 0, skips: 0 },
  ), [ranked]);

  const decimal = useMemo(() => new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }), [lang]);
  const percent = useMemo(() => new Intl.NumberFormat(lang, { style: 'percent', maximumFractionDigits: 0 }), [lang]);

  function handleExport() {
    const data = buildCameraStatsExport(stats ?? []);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `librax-camera-${data.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleClear() {
    setConfirmClear(false);
    await clearCameraStats().catch(() => {});
    setStats(await listCameraStats().catch(() => []));
  }

  return (
    <div className="sub-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('cameraStats.title')}</h1>
      </div>

      <div className="cam-stats-body">
        <p className="cam-stats-intro">{t('cameraStats.intro')}</p>

        {stats !== null && ranked.length === 0 && (
          <div className="cam-stats-empty">
            <Icon name="query_stats" size="64px" className="cam-stats-empty-icon" />
            <h2>{t('cameraStats.emptyTitle')}</h2>
            <p>{t('cameraStats.emptyBody')}</p>
          </div>
        )}

        {ranked.length > 0 && (
          <>
            <ul className="cam-stats-summary" aria-label={t('cameraStats.summaryLabel')}>
              <li className="cam-stats-chip">{t('cameraStats.summarySigns', { n: ranked.length })}</li>
              <li className="cam-stats-chip">{t('cameraStats.summarySuccesses', { n: totals.successes })}</li>
              <li className="cam-stats-chip">{t('cameraStats.summarySkips', { n: totals.skips })}</li>
            </ul>

            <h2 className="settings-group-label cam-stats-list-label" id="cam-stats-list-label">
              {t('cameraStats.listLabel')}
            </h2>
            <ol className="cam-stats-list" aria-labelledby="cam-stats-list-label">
              {ranked.map(s => (
                <CameraStatsItem key={s.signId} s={s} t={t} decimal={decimal} percent={percent} />
              ))}
            </ol>

            <div className="cam-stats-actions">
              <button className="btn btn-secondary" onClick={handleExport}>
                <Icon name="download" /> {t('cameraStats.export')}
              </button>
              <button className="btn btn-secondary cam-stats-clear" onClick={() => setConfirmClear(true)}>
                <Icon name="delete" /> {t('cameraStats.clear')}
              </button>
            </div>
          </>
        )}

        <p className="cam-stats-note">
          <Icon name="shield" /> <span>{t('cameraStats.privacyNote')}</span>
        </p>
      </div>

      <Dialog
        isOpen={confirmClear}
        title={t('cameraStats.clearTitle')}
        message={t('cameraStats.clearMessage')}
        confirmLabel={t('cameraStats.clearConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

interface ItemProps {
  s: CameraSignSummary;
  t: TFunc;
  decimal: Intl.NumberFormat;
  percent: Intl.NumberFormat;
}

function CameraStatsItem({ s, t, decimal, percent }: ItemProps) {
  const kind = t(s.kind === 'letter' ? 'cameraStats.kindLetter'
    : s.kind === 'number' ? 'cameraStats.kindNumber' : 'cameraStats.kindSign');
  return (
    <li className="cam-stats-item">
      <div className="cam-stats-head">
        <h3 className={`cam-stats-gloss${s.label.length > 2 ? ' cam-stats-gloss--word' : ''}`}>
          <span className="sr-only">{kind} </span>{s.label}
        </h3>
        <div className="cam-stats-head-text">
          <span className="cam-stats-kind" aria-hidden="true">{kind}</span>
          <span className="cam-stats-runs">{t('cameraStats.runs', { n: s.runs })}</span>
        </div>
        <span className={`cam-stats-level cam-stats-level--${s.level}`}>
          <Icon name={LEVEL_ICON[s.level]} filled={s.level !== 'ok'} />
          {t(`cameraStats.level.${s.level}`)}
        </span>
      </div>

      <dl className="cam-stats-metrics">
        <div className="cam-stats-metric">
          <dt>{t('cameraStats.skips')}</dt>
          <dd className="tabular">
            {t('cameraStats.skipsValue', { skips: s.skips, runs: s.runs, pct: percent.format(s.skipRate) })}
          </dd>
        </div>
        <div className="cam-stats-metric">
          <dt>{t('cameraStats.attempts')}</dt>
          <dd className="tabular">
            {s.avgAttempts === null
              ? t('cameraStats.attemptsNone')
              : t('cameraStats.attemptsValue', { avg: decimal.format(s.avgAttempts), successes: s.successes })}
          </dd>
        </div>
      </dl>

      {s.topWrong.length > 0 && (
        <div className="cam-stats-wrong">
          <span className="cam-stats-wrong-label" id={`wrong-${s.signId}`}>{t('cameraStats.readAs')}</span>
          <ul className="cam-stats-wrong-list" aria-labelledby={`wrong-${s.signId}`}>
            {s.topWrong.map(w => (
              <li key={w.label} className="cam-stats-wrong-chip">
                {t('cameraStats.readAsItem', { label: w.label, count: w.count })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
