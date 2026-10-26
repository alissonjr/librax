import { useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { InstallSheet, useInstallMode } from './InstallSheet';
import {
  getInstallMode, loadBannerState, loadInviteState, promptInstall, recordBannerDismissed,
  shouldShowInstallBanner,
} from '../lib/install';

interface Props {
  /** O convite completo (InstallSheet do AppOpenFlow) está na vez: a faixa não aparece junto. */
  suppressed?: boolean;
}

/**
 * Faixa discreta no topo do mapa sugerindo instalar o app, desde a primeira visita, quando ele está
 * numa aba do navegador (decisão 13 do plano, spec-02 12.1). Chrome e Edge: "Instalar o app" abre o
 * pedido nativo. Safari do iPhone e do iPad: "Como instalar" abre as instruções do InstallSheet.
 * Onde não dá para instalar, ou com o app instalado, não aparece.
 *
 * Só no mapa: nunca na lição, nas boas-vindas, na câmera nem na abertura. A decisão de mostrar é
 * tomada quando a faixa monta, junto com o conteúdo do mapa, para não empurrar a tela depois: se o
 * pedido nativo chegar mais tarde, a faixa fica para a próxima vez que o mapa abrir.
 */
export function InstallBanner({ suppressed = false }: Props) {
  const { t } = useT();
  const mode = useInstallMode();
  const [eligible] = useState(() => !suppressed && shouldShowInstallBanner({
    mode: getInstallMode(),
    banner: loadBannerState(),
    invite: loadInviteState(),
    now: Date.now(),
  }));
  const [closed, setClosed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  function dismiss() {
    recordBannerDismissed();
    setClosed(true);
  }

  async function handleInstall() {
    if (mode === 'ios') {
      setShowSteps(true);
      return;
    }
    const outcome = await promptInstall().catch(() => null);
    // Aceito: o evento appinstalled esconde tudo. Recusado no pedido nativo: conta como fechar.
    if (outcome === 'dismissed') recordBannerDismissed();
    setClosed(true);
  }

  if (suppressed || mode === null) return null;

  if (showSteps) {
    return (
      <InstallSheet
        mode="ios"
        onClose={() => {
          setShowSteps(false);
          dismiss();
        }}
      />
    );
  }

  if (!eligible || closed) return null;

  return (
    <section className="install-banner" aria-labelledby="install-banner-title">
      <span className="install-banner-icon">
        <Icon name="mobile_arrow_down" filled />
      </span>
      <div className="install-banner-text">
        <h2 className="install-banner-title" id="install-banner-title">{t('install.bannerTitle')}</h2>
        <p className="install-banner-sub">{t(mode === 'ios' ? 'install.bannerSubIos' : 'install.bannerSub')}</p>
      </div>
      <button className="btn btn-secondary btn-sm install-banner-action" onClick={handleInstall}>
        {t(mode === 'ios' ? 'install.bannerHowTo' : 'install.bannerInstall')}
      </button>
      <button className="back-btn install-banner-close" onClick={dismiss} aria-label={t('install.bannerClose')}>
        <Icon name="close" />
      </button>
    </section>
  );
}
