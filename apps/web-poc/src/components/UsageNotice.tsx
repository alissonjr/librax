import { useState } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { LegalLink } from './LegalLinks';
import { ROUTES } from '../lib/routes';
import { markPolicySeen, usageNoticePending } from '../lib/usageNotice';

/**
 * Aviso de uma vez só, no topo do mapa, para quem já usava o app antes dos dados de uso anônimos
 * (lib/usageNotice.ts). Curto: são métricas de uso para calibrar o algoritmo e os exercícios, sem
 * identificar a pessoa. Links para a política e para o interruptor das Configurações. Fechar, abrir
 * a política ou abrir as Configurações conta como visto. Mesmo formato da faixa de instalar.
 */
export function UsageNotice() {
  const { t } = useT();
  const inRouter = useInRouterContext();
  const [open, setOpen] = useState(usageNoticePending);

  if (!open) return null;

  const seen = () => {
    markPolicySeen();
    setOpen(false);
  };

  const settingsClass = 'btn btn-secondary btn-sm install-banner-action';
  return (
    <section className="install-banner usage-notice" aria-labelledby="usage-notice-title">
      <span className="install-banner-icon">
        <Icon name="query_stats" />
      </span>
      <div className="install-banner-text">
        <h2 className="install-banner-title" id="usage-notice-title">{t('usageNotice.title')}</h2>
        <p className="install-banner-sub">
          {t('usageNotice.body')}{' '}
          <span onClick={seen}>
            <LegalLink to={ROUTES.privacy}>{t('usageNotice.policy')}</LegalLink>
          </span>
        </p>
      </div>
      {inRouter
        ? <Link to={ROUTES.settings} className={settingsClass} onClick={seen}>{t('usageNotice.settings')}</Link>
        : <a href={ROUTES.settings} className={settingsClass} onClick={seen}>{t('usageNotice.settings')}</a>}
      <button className="back-btn install-banner-close" onClick={seen} aria-label={t('usageNotice.close')}>
        <Icon name="close" />
      </button>
    </section>
  );
}
