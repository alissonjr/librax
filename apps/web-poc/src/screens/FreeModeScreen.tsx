import { useCallback, useEffect, useRef, useState } from 'react';
import { useFreeModeCamera, type FreeView } from '../hooks/useFreeModeCamera';
import { warmUpHandLandmarker } from '../recognition/landmarker';
import type { FreeMode } from '../lib/freeSpell';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { Toast } from '../components/Toast';
import '../styles/freeMode.css';

/** Modo escolhido da última vez (só conveniência desta tela, neste aparelho). */
const MODE_KEY = 'librax_freeMode';

function readMode(): FreeMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'numeros' ? 'numeros' : 'letras';
  } catch {
    return 'letras';
  }
}

function saveMode(mode: FreeMode) {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch { /* sem armazenamento: só não lembra */ }
}

const MODES: { id: FreeMode; key: string }[] = [
  { id: 'letras', key: 'freeMode.modeLetters' },
  { id: 'numeros', key: 'freeMode.modeNumbers' },
];

/** Texto do anúncio para o leitor de tela quando entra algo novo no texto. */
function announcement(t: ReturnType<typeof useT>['t'], ev: FreeView['lastEvent']): string {
  if (!ev) return '';
  if (ev.kind === 'space') return t('freeMode.announceSpace');
  if (ev.kind === 'replace') return t('freeMode.announceReplace', { char: ev.char });
  return ev.char;
}

/**
 * Modo livre da câmera (rota /camera/livre): a pessoa soletra o que quiser e o texto vai se
 * formando, para praticar fora das lições e mostrar o app para alguém. Letras ou Números, um de
 * cada vez. Nada vai para o progresso das lições nem sai do aparelho (lib/freeSpell.ts).
 */
export function FreeModeScreen() {
  const { t } = useT();
  const [mode, setMode] = useState<FreeMode>(readMode);
  const cam = useFreeModeCamera(mode);
  const { status, view, recognizable } = cam;
  const [toast, setToast] = useState<string | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { warmUpHandLandmarker(); }, []);

  // O fim do texto fica sempre à vista
  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [view.text]);

  const choose = (next: FreeMode) => {
    setMode(next);
    saveMode(next);
  };

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(view.text.trim());
      setToast(t('freeMode.copied'));
    } catch {
      setToast(t('freeMode.copyFailed'));
    }
  }, [view.text, t]);

  const dismissToast = useCallback(() => setToast(null), []);

  const active = status === 'active';
  const empty = view.text.length === 0;
  // Só mostra leitura do que este modo escreve (no modo Números, os que passaram no teste)
  const current = view.current && recognizable
    && (recognizable.still.includes(view.current.letter) || recognizable.motion.includes(view.current.letter))
    ? view.current : null;
  const hint = view.hint === 'motion'
    ? t('freeMode.hintMotion', { letter: view.hintLetter ?? '' })
    : view.hint === 'release'
      ? t('freeMode.hintRelease')
      : view.hint === 'hold'
        ? t('freeMode.hintHold')
        : null;
  const numbersMissing = mode === 'numeros' && recognizable?.unavailable === true;

  return (
    <div className="fm-screen">
      <p className="fm-intro">{t('freeMode.subtitle')}</p>

      <div className="fm-switch" role="radiogroup" aria-label={t('freeMode.modeLabel')}>
        {MODES.map((m, i) => (
          <button
            key={m.id}
            ref={el => { modeRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            tabIndex={mode === m.id ? 0 : -1}
            className="fm-switch-option"
            onClick={() => choose(m.id)}
            onKeyDown={e => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
              e.preventDefault();
              const j = (i + 1) % MODES.length;
              choose(MODES[j].id);
              modeRefs.current[j]?.focus();
            }}
          >
            {t(m.key)}
          </button>
        ))}
      </div>

      {status === 'idle' && (
        <div className="camera-idle fm-idle">
          <div className="camera-idle-icon"><Icon name="videocam" /></div>
          <p>{t('freeMode.idle')}</p>
          <button className="btn btn-primary btn-inline" onClick={cam.start}>
            <Icon name="videocam" /> {t('freeMode.activate')}
          </button>
        </div>
      )}

      {status === 'loading' && (
        <div className="camera-idle fm-idle" role="status">
          <div className="camera-idle-icon"><Icon name="progress_activity" spin /></div>
          <p>{t('freeMode.loading')}</p>
        </div>
      )}

      {(status === 'denied' || status === 'error' || status === 'unsupported') && (
        <div className="camera-idle camera-idle--error fm-idle" role="alert">
          <div className="camera-idle-icon"><Icon name="videocam_off" /></div>
          <p>{t(`freeMode.${status}`)}</p>
          {status !== 'unsupported' && (
            <button className="btn btn-primary btn-inline" onClick={cam.start}>{t('freeMode.retry')}</button>
          )}
        </div>
      )}

      <div className={`fm-stage${active ? '' : ' camera-area--hidden'}`}>
        <div className="camera-viewport fm-viewport">
          <video ref={cam.videoRef} className="camera-video" playsInline muted aria-label={t('freeMode.feedLabel')} />
          <canvas ref={cam.canvasRef} className="camera-canvas" aria-hidden="true" />
          <div className={`cam-guide${view.handPresent ? ' cam-guide--ok' : ''}`} aria-hidden="true" />

          {current && (
            <div className="fm-reading" aria-hidden="true">
              <span className="fm-reading-label">{current.motion ? t('freeMode.readingMotion') : t('freeMode.reading')}</span>
              <span key={current.letter} className="fm-reading-letter">{current.letter}</span>
              <span className="fm-reading-meter">
                <span style={{ width: `${Math.round(Math.min(1, current.confidence) * 100)}%` }} />
              </span>
            </div>
          )}

          <div className="fm-status" role="status">
            {numbersMissing ? (
              <p className="fm-pill"><Icon name="cloud_off" /> {t('freeMode.numbersUnavailable')}</p>
            ) : hint ? (
              <p className="fm-pill"><Icon name="lightbulb" /> {hint}</p>
            ) : !view.handPresent && empty ? (
              <p className="fm-pill"><Icon name="sign_language" /> {t('freeMode.noHand')}</p>
            ) : null}
          </div>
        </div>
      </div>

      {(active || !empty) && (
      <section className="fm-text" aria-labelledby="fm-text-label">
        <h2 id="fm-text-label" className="fm-text-label">{t('freeMode.textLabel')}</h2>
        <div ref={textRef} className={`fm-text-box${empty ? ' fm-text-box--empty' : ''}`} tabIndex={0}>
          {empty
            ? <span className="fm-text-placeholder">{t('freeMode.placeholder')}</span>
            : (
              <span className="fm-text-value">
                {view.text}
                {active && <span className="fm-caret" aria-hidden="true" />}
              </span>
            )}
        </div>
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          <span key={view.lastEvent?.seq ?? 0}>{announcement(t, view.lastEvent)}</span>
        </div>
        <div className="fm-actions">
          <button type="button" className="fm-action" onClick={cam.addSpace} disabled={empty || view.text.endsWith(' ')}>
            <Icon name="space_bar" /> <span>{t('freeMode.space')}</span>
          </button>
          <button type="button" className="fm-action" onClick={cam.deleteLast} disabled={empty}>
            <Icon name="backspace" /> <span>{t('freeMode.deleteLast')}</span>
          </button>
          <button type="button" className="fm-action" onClick={cam.clear} disabled={empty}>
            <Icon name="delete" /> <span>{t('freeMode.clear')}</span>
          </button>
          <button type="button" className="fm-action" onClick={copy} disabled={view.text.trim().length === 0}>
            <Icon name="content_copy" /> <span>{t('freeMode.copy')}</span>
          </button>
        </div>
      </section>
      )}

      <section className="fm-help" aria-labelledby="fm-help-title">
        <h2 id="fm-help-title" className="fm-help-title">{t('freeMode.tipsTitle')}</h2>
        <ul className="fm-tips">
          <li>{t('freeMode.tipPause')}</li>
          <li>{t('freeMode.tipSpace')}</li>
          <li>{t('freeMode.tipPrivate')}</li>
        </ul>
        {recognizable && recognizable.still.length > 0 && (
          <div className="fm-chips-group">
            <p className="fm-chips-title">{t(mode === 'numeros' ? 'freeMode.numbersList' : 'freeMode.stillLetters')}</p>
            <div className="gesture-help-letters">
              {recognizable.still.map(l => (
                <span key={l} className={`gesture-chip${current?.letter === l ? ' gesture-chip--active' : ''}`}>{l}</span>
              ))}
            </div>
          </div>
        )}
        {recognizable && recognizable.motion.length > 0 && (
          <div className="fm-chips-group">
            <p className="fm-chips-title">{t('freeMode.motionLetters')}</p>
            <div className="gesture-help-letters">
              {recognizable.motion.map(l => (
                <span key={l} className={`gesture-chip${current?.letter === l ? ' gesture-chip--active' : ''}`}>{l}</span>
              ))}
            </div>
          </div>
        )}
      </section>

      {toast && <Toast message={toast} onDone={dismissToast} />}
    </div>
  );
}
