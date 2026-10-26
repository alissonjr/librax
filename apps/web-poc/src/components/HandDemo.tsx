import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import type { Sign } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { SignDemo, avatarGloss } from './SignDemo';
import '../styles/mao3d.css';
import { getDemoView, hasHand3d, setDemoView, webglAvailable, type DemoView } from '../mao3d/disponivel';

/**
 * Demonstração da apresentação (sign_intro). Nas letras do alfabeto manual e nos números de 0 a 9
 * entra a mão em 3D (src/mao3d/), com mãos de pessoas reais: a forma da mão, que dá para girar, e o
 * movimento real das letras com movimento. Quando o sinal também tem avatar (ou vídeo), as duas
 * ficam em abas, "Mão 3D | Avatar", abrindo na mão (ou na última aba escolhida). Sem avatar (Ç), a
 * mão é a demonstração. Sem 3D no navegador, ou se o 3D falhar, fica o SignDemo de sempre (avatar
 * ou descrição em texto). Nos sinais de palavras nada muda: o avatar mostra o sinal inteiro (lugar
 * no corpo e expressão do rosto).
 *
 * O motor 3D, o modelo e as poses só baixam aqui (import sob demanda); o service worker guarda os
 * três (precache), então funciona offline.
 */
const Mao3DView = lazy(() => import('../mao3d/Mao3DView'));

/** Erro ao baixar o pedaço do 3D (offline sem cache, por exemplo): volta para o SignDemo. */
class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function Loading({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <figure className={`sign-demo mao3d${className ? ` ${className}` : ''}`}>
      <div className="sign-demo-stage mao3d-stage">
        <div className="mao3d-screen">
          <div className="sign-demo-loading mao3d-loading" aria-live="polite">
            <Icon name="progress_activity" spin size="32px" />
            <p>{t('mao3d.loading')}</p>
          </div>
        </div>
      </div>
    </figure>
  );
}

interface Props {
  sign: Sign;
  /** O que aparece sem 3D, sem vídeo e sem avatar (a descrição de hoje). */
  fallback: ReactNode;
  className?: string;
}

export function HandDemo({ sign, fallback, className }: Props) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<DemoView>(getDemoView);
  const show3d = hasHand3d(sign) && !failed && webglAvailable();
  const signDemo = <SignDemo sign={sign} className={className} fallback={fallback} />;
  if (!show3d) return signDemo;

  const hand = (
    <Boundary onError={() => setFailed(true)}>
      <Suspense fallback={<Loading className={className} />}>
        <Mao3DView sign={sign} className={className} onError={() => setFailed(true)} />
      </Suspense>
    </Boundary>
  );
  const other = !!sign.video_url || avatarGloss(sign) !== null;
  if (!other) return hand;

  const choose = (v: DemoView) => {
    setView(v);
    setDemoView(v);
  };
  const tabs: { id: DemoView; label: string; icon: 'view_in_ar' | 'person' }[] = [
    { id: 'mao3d', label: t('mao3d.tab3d'), icon: 'view_in_ar' },
    { id: 'avatar', label: t(sign.video_url ? 'mao3d.tabVideo' : 'mao3d.tabAvatar'), icon: 'person' },
  ];
  const panelId = `hand-demo-${sign.id}`;

  return (
    <div className="hand-demo">
      <div className="hand-demo-tabs" role="tablist" aria-label={t('mao3d.tabsLabel')}>
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${panelId}-${tab.id}`}
            aria-selected={view === tab.id}
            aria-controls={panelId}
            tabIndex={view === tab.id ? 0 : -1}
            className="hand-demo-tab"
            onClick={() => choose(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const next = tabs[(i + 1) % tabs.length];
              choose(next.id);
              document.getElementById(`${panelId}-${next.id}`)?.focus();
            }}
          >
            <Icon name={tab.icon} filled={view === tab.id} /> {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${view}`} className="hand-demo-panel">
        {view === 'mao3d' ? hand : signDemo}
      </div>
    </div>
  );
}
