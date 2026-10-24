import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Sign } from '../lib/content';
import { useT, withLinks, type TFunc } from '../i18n';
import {
  VLIBRAS_LICENSE_URL,
  VLIBRAS_SITE_URL,
  VLIBRAS_SPEEDS,
  attachVlibras,
  getVlibrasState,
  play,
  retryVlibras,
  setVlibrasSpeed,
  stopVlibras,
  subscribeVlibras,
  type VlibrasSpeed,
} from '../lib/vlibras';
import { Icon } from './Icon';
import { TraceArrowIcon } from './Brand';

export type DemoMode = 'video' | 'avatar' | 'text';

/** Glosa do VLibras do sinal, ou null se o avatar não cobre este sinal. */
export function avatarGloss(sign: Sign): string | null {
  return sign.avatar?.provider === 'vlibras' && sign.avatar.gloss ? sign.avatar.gloss : null;
}

/**
 * Ordem de prioridade da demonstração: vídeo com pessoa real, depois o avatar VLibras e,
 * por último (ou se o avatar falhou), a descrição em texto.
 */
export function chooseDemoMode(sign: Sign, avatarFailed = false): DemoMode {
  if (sign.video_url) return 'video';
  if (!avatarFailed && avatarGloss(sign)) return 'avatar';
  return 'text';
}

/** Crédito exigido pela licença, discreto, junto ao avatar e nas Configurações. */
export function VlibrasCredit({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <p className={className ?? 'sign-demo-credit'}>
      {withLinks(t('signDemo.credit'), {
        vlibras: <a href={VLIBRAS_SITE_URL} target="_blank" rel="noopener noreferrer">VLibras</a>,
        license: <a href={VLIBRAS_LICENSE_URL} target="_blank" rel="noopener noreferrer">LGPL-3.0</a>,
      })}
    </p>
  );
}

function formatSpeed(speed: number, lang: string) {
  return `${new Intl.NumberFormat(lang).format(speed)}x`;
}

function nextSpeed(speed: VlibrasSpeed): VlibrasSpeed {
  const i = VLIBRAS_SPEEDS.indexOf(speed);
  return VLIBRAS_SPEEDS[(i + 1) % VLIBRAS_SPEEDS.length];
}

interface ControlsProps {
  t: TFunc;
  lang: string;
  speed: VlibrasSpeed;
  disabled: boolean;
  onReplay: () => void;
  onSpeed: () => void;
}

function DemoControls({ t, lang, speed, disabled, onReplay, onSpeed }: ControlsProps) {
  const label = formatSpeed(speed, lang);
  return (
    <div className="sign-demo-controls">
      <button
        type="button"
        className="sign-demo-btn sign-demo-btn--move"
        onClick={onReplay}
        disabled={disabled}
        aria-label={t('signDemo.replayLabel')}
      >
        <TraceArrowIcon /> {t('signDemo.replay')}
      </button>
      <button
        type="button"
        className="sign-demo-btn"
        onClick={onSpeed}
        disabled={disabled}
        aria-label={t('signDemo.speedLabel', { speed: label })}
      >
        <Icon name="speed" /> <span className="tabular">{label}</span>
      </button>
    </div>
  );
}

interface Props {
  sign: Sign;
  /**
   * "Qual é este sinal?": nada pode entregar a resposta. O rótulo acessível não leva a glosa
   * e a legenda do player fica desligada (ela já fica desligada em todos os modos).
   */
  conceal?: boolean;
  /** O que aparece sem vídeo e sem avatar, ou quando o avatar falha (a descrição de hoje). */
  fallback: ReactNode;
  className?: string;
}

/**
 * Demonstração do sinal: vídeo, avatar VLibras ou descrição em texto, nessa ordem.
 * O avatar é uma instância única (src/lib/vlibras.ts), carregada só quando um exercício
 * mostra este componente e reaproveitada nos seguintes.
 */
export function SignDemo({ sign, conceal = false, fallback, className }: Props) {
  const { t } = useT();
  const vl = useSyncExternalStore(subscribeVlibras, getVlibrasState);
  const [playFailed, setPlayFailed] = useState(false);
  const mode = chooseDemoMode(sign, playFailed || vl.status === 'error');
  const gloss = avatarGloss(sign);
  const failed = mode === 'text' && gloss !== null && !sign.video_url;
  const label = conceal
    ? t(mode === 'video' ? 'signDemo.videoLabelHidden' : 'signDemo.avatarLabelHidden')
    : t(mode === 'video' ? 'signDemo.videoLabel' : 'signDemo.avatarLabel', { gloss: sign.gloss });

  if (mode === 'video' && sign.video_url) {
    return <VideoDemo src={sign.video_url} label={label} className={className} />;
  }

  if (mode === 'avatar' && gloss) {
    return (
      <AvatarDemo
        key={sign.id}
        gloss={gloss}
        label={label}
        className={className}
        onFail={() => setPlayFailed(true)}
      />
    );
  }

  return (
    <>
      {fallback}
      {failed && (
        <div className="sign-demo-fail" role="status">
          <Icon name="cloud_off" />
          <span>{t(vl.error === 'offline' ? 'signDemo.failedOffline' : 'signDemo.failed')}</span>
          <button
            type="button"
            className="btn-text sign-demo-retry"
            onClick={() => {
              setPlayFailed(false);
              if (getVlibrasState().status === 'error') retryVlibras();
            }}
          >
            {t('signDemo.retry')}
          </button>
        </div>
      )}
    </>
  );
}

function AvatarDemo({ gloss, label, className, onFail }: { gloss: string; label: string; className?: string; onFail: () => void }) {
  const { t, lang } = useT();
  const vl = useSyncExternalStore(subscribeVlibras, getVlibrasState);
  const slotRef = useRef<HTMLDivElement>(null);
  const ready = vl.status === 'ready';

  useEffect(() => {
    if (!slotRef.current) return;
    const detach = attachVlibras(slotRef.current);
    return () => {
      stopVlibras();
      detach();
    };
  }, []);

  // Toca uma vez quando o player fica pronto; depois só pelo botão "Repetir"
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    play(gloss).then((ok) => { if (alive && !ok) onFail(); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, gloss]);

  function replay() {
    play(gloss).then((ok) => { if (!ok) onFail(); });
  }

  const pct = Math.round(vl.progress * 100);

  return (
    <figure className={`sign-demo${className ? ` ${className}` : ''}`}>
      <div className="sign-demo-stage" role="img" aria-label={label}>
        <div ref={slotRef} className="sign-demo-screen" />
        {!ready && (
          <div className="sign-demo-loading" aria-live="polite">
            <Icon name="progress_activity" spin size="32px" />
            <p>{pct > 0 && pct < 100 ? t('signDemo.loadingProgress', { pct }) : t(pct >= 100 ? 'signDemo.preparing' : 'signDemo.loading')}</p>
            <div
              className="sign-demo-progress"
              role="progressbar"
              aria-label={t('signDemo.loading')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
            >
              <div className="sign-demo-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
      </div>
      <DemoControls
        t={t}
        lang={lang}
        speed={vl.speed}
        disabled={!ready}
        onReplay={replay}
        onSpeed={() => {
          setVlibrasSpeed(nextSpeed(vl.speed));
          replay();
        }}
      />
      <figcaption>
        <VlibrasCredit />
      </figcaption>
    </figure>
  );
}

function VideoDemo({ src, label, className }: { src: string; label: string; className?: string }) {
  const { t, lang } = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [speed, setSpeed] = useState<VlibrasSpeed>(1);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
  }, [speed]);

  function replay() {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    void v.play().catch(() => {});
  }

  return (
    <figure className={`sign-demo sign-demo--video${className ? ` ${className}` : ''}`}>
      <div className="sign-demo-stage">
        <video
          ref={videoRef}
          src={src}
          className="sign-demo-video"
          autoPlay
          loop
          muted
          playsInline
          aria-label={label}
        />
      </div>
      <DemoControls
        t={t}
        lang={lang}
        speed={speed}
        disabled={false}
        onReplay={replay}
        onSpeed={() => setSpeed((s) => nextSpeed(s))}
      />
    </figure>
  );
}
