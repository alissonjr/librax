/*
 * Mão em 3D da apresentação das letras e dos números (carregada sob demanda pelo HandDemo):
 * a forma da mão de pessoas reais, que dá para girar, e o movimento real das letras com movimento.
 *
 * Controles: tocar e pausar (letra parada: a mão gira devagar; letra com movimento: o movimento),
 * 0,5x nas letras com movimento, outra mão (outra pessoa), girar com o dedo ou pelos botões (e pelas
 * setas do teclado), ver de frente e o tom da pele. Com menos movimento a mão abre parada.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import glbUrl from './mao-3d.glb?url';
import type { Sign } from '../lib/content';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { TraceArrowIcon } from '../components/Brand';
import { SKIN_TONES, getSkinTone, prefersReducedMotion, setSkinTone } from './disponivel';
import { clipFor } from './poses';
import { ROTATE_STEP, createMotor, type Motor } from './motor';
import { midMovementMs } from './linhaDoTempo';

let modelPromise: Promise<ArrayBuffer> | null = null;

/** O modelo (cerca de 150 KB), baixado uma vez por sessão; o service worker guarda (precache). */
export function loadHandModel(fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  if (!modelPromise) {
    modelPromise = fetchImpl(glbUrl).then((r) => {
      if (!r.ok) throw new Error(`mao-3d.glb: HTTP ${r.status}`);
      return r.arrayBuffer();
    });
    modelPromise.catch(() => { modelPromise = null; });
  }
  return modelPromise;
}

const SPEEDS = [1, 0.5] as const;
/** Arrastar: radianos por pixel. */
const DRAG = 0.012;

interface Props {
  sign: Pick<Sign, 'gloss' | 'category' | 'recognition' | 'params'>;
  className?: string;
  /** Sem 3D (falhou ao carregar, sem GPU, contexto perdido): quem chamou mostra o avatar ou o texto. */
  onError: () => void;
}

export default function Mao3DView({ sign, className, onError }: Props) {
  const { t, lang } = useT();
  const clip = useMemo(() => clipFor(sign.gloss), [sign.gloss]);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<Motor | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(!reduced);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [person, setPerson] = useState(0);
  const [tone, setTone] = useState(getSkinTone);
  const [picker, setPicker] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const moving = !!clip?.moving;

  useEffect(() => {
    if (!clip) {
      onErrorRef.current();
      return;
    }
    let alive = true;
    (async () => {
      try {
        const model = await loadHandModel();
        if (!alive || !canvasRef.current || !stageRef.current) return;
        const motor = await createMotor(canvasRef.current, stageRef.current, clip, model, {
          reduced,
          tone: getSkinTone(),
          playing: !reduced,
          speed: 1,
          onLost: () => onErrorRef.current(),
        });
        if (!alive) {
          motor.dispose();
          return;
        }
        motorRef.current = motor;
        // Conferência (?mao3d=meio, como o ?letra= da abertura da landing): o movimento parado no meio
        if (moving && typeof location !== 'undefined' && new URLSearchParams(location.search).get('mao3d') === 'meio') {
          motor.setPlaying(false);
          motor.seek(midMovementMs(clip.people[0].frames.length));
          setPlaying(false);
        }
        setReady(true);
      } catch {
        if (alive) onErrorRef.current();
      }
    })();
    return () => {
      alive = false;
      motorRef.current?.dispose();
      motorRef.current = null;
    };
  }, [clip, reduced, moving]);

  useEffect(() => { motorRef.current?.setPlaying(playing); }, [playing, ready]);
  useEffect(() => { motorRef.current?.setSpeed(speed); }, [speed, ready]);
  useEffect(() => { motorRef.current?.setPerson(person); }, [person, ready]);
  useEffect(() => { motorRef.current?.setTone(tone); }, [tone, ready]);

  if (!clip) return null;

  const total = clip.people.length;
  const what = sign.category === 'numeros' ? t('mao3d.number', { gloss: sign.gloss }) : t('mao3d.letter', { gloss: sign.gloss });
  const label = t('mao3d.label', { what, cm: sign.params.CM });
  const speedLabel = `${new Intl.NumberFormat(lang).format(speed)}x`;
  // O movimento das letras que a câmera avalia paradas (H, K, X) não aparece na apresentação
  const movementCaption = moving && sign.recognition !== 'dynamic' && sign.params.MOV && sign.params.MOV !== 'nenhum'
    ? t('exerciseIntro.movement', { mov: sign.params.MOV })
    : null;

  function rotate(yaw: number, pitch = 0) {
    // Mexeu na vista: a mão parada para de girar sozinha
    if (!moving && playing) setPlaying(false);
    motorRef.current?.rotateBy(yaw, pitch);
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest('button')) return;
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    // No toque, o arrasto vertical rola a tela (touch-action: pan-y): só o mouse inclina
    const dy = e.pointerType === 'mouse' ? e.clientY - d.y : 0;
    d.x = e.clientX;
    d.y = e.clientY;
    if (dx || dy) rotate(dx * DRAG, dy * DRAG);
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = ROTATE_STEP / 2;
    const map: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (e.target !== e.currentTarget || !map[e.key]) return;
    e.preventDefault();
    rotate(...map[e.key]);
  }

  return (
    <figure className={`sign-demo mao3d${className ? ` ${className}` : ''}`}>
      <div
        ref={stageRef}
        className="sign-demo-stage mao3d-stage"
        role="group"
        aria-label={t('mao3d.stageLabel')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-ready={ready || undefined}
      >
        <div className="mao3d-screen">
        <canvas ref={canvasRef} className="mao3d-canvas" role="img" aria-label={label} />
        {!ready && (
          <div className="sign-demo-loading mao3d-loading" aria-live="polite">
            <Icon name="progress_activity" spin size="32px" />
            <p>{t('mao3d.loading')}</p>
          </div>
        )}
        {ready && (
          <>
            <button
              type="button"
              className="mao3d-tool mao3d-tool--skin"
              aria-label={t('mao3d.skin')}
              aria-expanded={picker}
              onClick={() => setPicker((v) => !v)}
            >
              <span className="mao3d-swatch" style={{ background: SKIN_TONES[tone] }} />
            </button>
            {picker && (
              <div className="mao3d-skins" role="radiogroup" aria-label={t('mao3d.skin')}>
                {SKIN_TONES.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={i === tone}
                    aria-label={t('mao3d.skinOption', { n: i + 1, total: SKIN_TONES.length })}
                    className="mao3d-skin"
                    onClick={() => {
                      setTone(i);
                      setSkinTone(i);
                      setPicker(false);
                    }}
                  >
                    <span className="mao3d-swatch" style={{ background: c }} />
                  </button>
                ))}
              </div>
            )}
            {total > 1 && (
              <button
                type="button"
                className="mao3d-tool mao3d-tool--person"
                onClick={() => setPerson((p) => (p + 1) % total)}
                aria-label={t('mao3d.personLabel', { n: person + 1, total })}
              >
                <Icon name="switch_account" />
              </button>
            )}
            <button type="button" className="mao3d-tool mao3d-tool--left" aria-label={t('mao3d.rotateLeft')} onClick={() => rotate(-ROTATE_STEP)}>
              <Icon name="rotate_left" />
            </button>
            <button type="button" className="mao3d-tool mao3d-tool--reset" aria-label={t('mao3d.reset')} onClick={() => motorRef.current?.resetView()}>
              <Icon name="recenter" />
            </button>
            <button type="button" className="mao3d-tool mao3d-tool--right" aria-label={t('mao3d.rotateRight')} onClick={() => rotate(ROTATE_STEP)}>
              <Icon name="rotate_right" />
            </button>
          </>
        )}
        </div>
      </div>
      <div className="sign-demo-controls">
        <button
          type="button"
          className={`sign-demo-btn${moving ? ' sign-demo-btn--move' : ''}`}
          onClick={() => setPlaying((v) => !v)}
          disabled={!ready}
          aria-pressed={playing}
          aria-label={t(moving ? 'mao3d.playMoveLabel' : 'mao3d.playTurnLabel')}
        >
          {playing ? <Icon name="pause" /> : moving ? <TraceArrowIcon /> : <Icon name="autorenew" />}
          {' '}
          {t(playing ? 'mao3d.pause' : moving ? 'mao3d.playMove' : 'mao3d.playTurn')}
        </button>
        {moving && (
          <button
            type="button"
            className="sign-demo-btn"
            onClick={() => setSpeed((s) => (s === 1 ? 0.5 : 1))}
            disabled={!ready}
            aria-label={t('signDemo.speedLabel', { speed: speedLabel })}
          >
            <Icon name="speed" /> <span className="tabular">{speedLabel}</span>
          </button>
        )}
      </div>
      <figcaption className="mao3d-caption">
        {movementCaption && <span className="mao3d-caption-mov">{movementCaption}</span>}
        <span>{t('mao3d.caption')}</span>
      </figcaption>
    </figure>
  );
}
