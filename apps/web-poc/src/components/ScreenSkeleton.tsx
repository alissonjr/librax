import { useT } from '../i18n';

/**
 * Carregamento de tela (design-system 11.11): skeleton com as formas de uma tela (barra do topo,
 * um cartão e uma lista), em `bg.sunken` com brilho passando, nunca tela branca. Usado enquanto o
 * pedaço da tela baixa (Suspense das rotas) e enquanto a tela lê os dados locais.
 */
export function ScreenSkeleton() {
  const { t } = useT();
  return (
    <div className="screen-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>
      <div className="skeleton-block screen-skeleton-bar" aria-hidden="true" />
      <div className="skeleton-block screen-skeleton-card" aria-hidden="true" />
      {[0, 1, 2].map(i => (
        <div key={i} className="screen-skeleton-row" aria-hidden="true">
          <div className="skeleton-block screen-skeleton-node" />
          <div className="screen-skeleton-lines">
            <div className="skeleton-block screen-skeleton-line" />
            <div className="skeleton-block screen-skeleton-line screen-skeleton-line--short" />
          </div>
        </div>
      ))}
    </div>
  );
}
