/*
 * As duas mãos da dica de erro (carregado sob demanda pelo WrongReadingHint): desenhadas uma vez
 * por desenhar.ts em imagens e mostradas em canvas 2D. Movimento: os quadros passam na linha do
 * tempo da mão em 3D (linhaDoTempo.ts), só enquanto toca; com menos movimento, só ao tocar no botão.
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { TraceArrowIcon } from '../components/Brand';
import { loadHandModel } from '../mao3d/Mao3DView';
import { getSkinTone, prefersReducedMotion } from '../mao3d/disponivel';
import { sampleAt } from '../mao3d/linhaDoTempo';
import { drawHands, type HandImages } from './desenhar';
import { HintPair, type PairCaptions } from './HintPair';
import type { Digit } from './forma';
import type { SignKind } from './dicas';

interface Props {
  asked: string;
  read: string;
  kind: SignKind;
  highlight: readonly Digit[];
  moving: 'asked' | 'read' | null;
  captions: PairCaptions;
  onError: () => void;
}

/** Cor do destaque: o token do dedo a ajustar na câmera (stage.landmark.retry). */
function highlightColor(el: Element | null): string {
  const v = el ? getComputedStyle(el).getPropertyValue('--lx-stage-landmark-retry').trim() : '';
  return v || '#FFAA2B';
}

/** Pinta um quadro (sem misturar dois: a mistura de imagens deixa a mão em dobro). */
function paint(canvas: HTMLCanvasElement | null, img: HandImages | undefined, frame: number) {
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx || !img) return;
  const a = img.frames[Math.max(0, Math.min(frame, img.frames.length - 1))];
  if (canvas.width !== a.width) {
    canvas.width = a.width;
    canvas.height = a.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(a, 0, 0);
}

export default function MaosComparadas({ asked, read, kind, highlight, moving, captions, onError }: Props) {
  const { t } = useT();
  const reduced = useRef(prefersReducedMotion()).current;
  const stageRef = useRef<HTMLDivElement>(null);
  const canvases = { asked: useRef<HTMLCanvasElement>(null), read: useRef<HTMLCanvasElement>(null) };
  const [images, setImages] = useState<{ asked: HandImages; read: HandImages } | null>(null);
  const [playing, setPlaying] = useState(!reduced);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const highlightKey = highlight.join(',');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const model = await loadHandModel();
        const stage = stageRef.current;
        if (!alive || !stage) return;
        const size = stage.getBoundingClientRect();
        const out = await drawHands({
          asked,
          read,
          highlight: highlightKey ? (highlightKey.split(',') as Digit[]) : [],
          moving,
          width: Math.max(64, Math.round(size.width)),
          height: Math.max(64, Math.round(size.height)),
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          tone: getSkinTone(),
          color: highlightColor(stage),
          model,
          yieldFrame: () => new Promise((ok) => setTimeout(() => ok(alive), 0)),
        });
        if (!alive) return;
        if (!out) throw new Error('mãos da dica indisponíveis');
        setImages(out);
      } catch {
        if (alive) onErrorRef.current();
      }
    })();
    return () => { alive = false; };
  }, [asked, read, highlightKey, moving]);

  const movingImages = images && moving ? images[moving] : null;
  const animated = !!movingImages && movingImages.frames.length > 1;

  // Primeira pintura: as duas mãos (a com movimento no meio dele)
  useEffect(() => {
    if (!images) return;
    for (const which of ['asked', 'read'] as const) {
      const img = images[which];
      paint(canvases[which].current, img, Math.floor((img.frames.length - 1) / 2));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // Movimento: troca as imagens na linha do tempo, só enquanto toca
  useEffect(() => {
    if (!animated || !playing || !moving || !movingImages) return;
    const canvas = canvases[moving].current;
    const start = performance.now();
    let shown = -1;
    let raf = requestAnimationFrame(function step(now) {
      const s = sampleAt(movingImages.frames.length, now - start);
      const frame = s.t < 0.5 ? s.from : s.to;
      if (frame !== shown) paint(canvas, movingImages, (shown = frame));
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animated, playing, moving, movingImages]);

  const what = (g: string) => t(kind === 'number' ? 'wrongHint.number' : 'wrongHint.letter', { g });
  const label = (which: 'asked' | 'read') => {
    const g = which === 'asked' ? asked : read;
    return t(moving === which ? 'wrongHint.handsLabelMove' : 'wrongHint.handsLabel', { what: what(g) });
  };

  return (
    <>
      <HintPair
        captions={captions}
        stage={(which) => (
          <div ref={which === 'asked' ? stageRef : undefined} className="wrong-hint-stage" data-ready={images ? true : undefined}>
            <canvas ref={canvases[which]} className="wrong-hint-canvas" role="img" aria-label={label(which)} />
            {!images && (
              <div className="wrong-hint-loading" aria-hidden="true">
                <Icon name="progress_activity" spin size="24px" />
              </div>
            )}
          </div>
        )}
      />
      {(highlight.length > 0 || animated) && (
        <div className="wrong-hint-tools">
          {highlight.length > 0 && (
            <span className="wrong-hint-legend">
              <span className="wrong-hint-swatch" aria-hidden="true" /> {t('wrongHint.highlightNote')}
            </span>
          )}
          {animated && (
            <button
              type="button"
              className="btn btn-secondary btn-sm wrong-hint-play"
              aria-pressed={playing}
              onClick={() => setPlaying((v) => !v)}
            >
              {playing ? <Icon name="pause" /> : <TraceArrowIcon />} {t(playing ? 'wrongHint.pauseMove' : 'wrongHint.playMove')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
