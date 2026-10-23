import { useId, type CSSProperties } from 'react';

/*
 * Marca Traço (estudo/marca/traco.html): o movimento do sinal vira desenho, com as setas de
 * trajetória dos dicionários de Libras. Ponto cheio onde o movimento começa, ponta onde termina.
 * As cores vêm dos tokens pelas classes em style.css (brand.*, game.trace.*, game.hand.*).
 */

/** id seguro para url(#...) a partir do useId do React (que traz dois-pontos). */
function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

/** Ponta de seta para marker-end, na cor da classe (trace, mão, borda ou palco). */
function ArrowMarker({ id, tone }: { id: string; tone: 'trace' | 'hand' | 'muted' | 'stage' }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
      <path d="M0 0 10 5 0 10z" className={`trace-tip trace-tip--${tone}`} />
    </marker>
  );
}

interface MarkProps {
  /** Lado em px. Até 24 px o traço engrossa e o ponto cresce (tamanho mínimo do traco.html). */
  size: number;
  /** "tile": ícone do app (grafite com seta tangerina); padrão: só o símbolo, nas cores do tema. */
  variant?: 'symbol' | 'tile';
  className?: string;
}

/** Símbolo: o L desenhado como um movimento, do ponto inicial à ponta da seta (caixa de 64). */
export function BrandMark({ size, variant = 'symbol', className }: MarkProps) {
  const small = size <= 24;
  return (
    <svg
      className={['brand-mark', `brand-mark--${variant}`, className ?? ''].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      focusable="false"
    >
      {variant === 'tile' && <rect className="brand-mark-tile" width="64" height="64" rx="18" />}
      <path className="brand-mark-trace" d="M20.0 21.0V33.0Q20.0 46.0 33.0 46.0H39.0" fill="none" strokeWidth={small ? 8 : 6.5} strokeLinecap="round" />
      <path className="brand-mark-tip" d="M37.0 36.5L52.0 46.0L37.0 55.5z" strokeWidth="2" strokeLinejoin="round" />
      <circle className="brand-mark-dot" cx="20" cy="12.5" r={small ? 6 : 5} />
    </svg>
  );
}

/** Palavra-marca: símbolo + "librax" em Anybody larga. `size` é o corpo do nome em px. */
export function Wordmark({ size, className }: { size: number; className?: string }) {
  return (
    <span
      className={['wordmark', className ?? ''].filter(Boolean).join(' ')}
      role="img"
      aria-label="Librax"
      style={{ '--wm': `${size}px` } as CSSProperties}
    >
      <BrandMark size={Math.round(size * 1.3)} />
      <span className="wordmark-text" aria-hidden="true">librax</span>
    </span>
  );
}

/** Ícone do botão "Ver o movimento": uma seta curva (24 x 24, segue a cor do texto). */
export function TraceArrowIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="icon trace-arrow-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 18C5 10 11 5 19 6" />
      <path d="M15 3l4 3-3 4" />
    </svg>
  );
}

/** Seta que gira em volta da lição atual do mapa (parada com menos movimento). */
export function TraceOrbit() {
  const tip = useSvgId('orbita');
  return (
    <svg className="trace-orbit" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs><ArrowMarker id={tip} tone="trace" /></defs>
      <path className="trace-stroke" d="M50 4 A46 46 0 1 1 9 29" fill="none" strokeWidth="3" strokeLinecap="round" markerEnd={`url(#${tip})`} />
    </svg>
  );
}

/** Arco decorativo do card de continuar, sobre o palco. */
export function TraceArc({ className }: { className?: string }) {
  const tip = useSvgId('arco');
  return (
    <svg className={className} viewBox="0 0 200 80" aria-hidden="true" focusable="false">
      <defs><ArrowMarker id={tip} tone="stage" /></defs>
      <path className="trace-stroke trace-stroke--stage" d="M8 74 C 60 6, 140 6, 192 44" fill="none" strokeWidth="3" strokeLinecap="round" markerEnd={`url(#${tip})`} />
    </svg>
  );
}

/** Setas curtas em volta da mão no acerto da câmera (sobre o palco). */
export function TraceCameraArcs({ className }: { className?: string }) {
  const tip = useSvgId('cam');
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <defs><ArrowMarker id={tip} tone="stage" /></defs>
      <path className="trace-stroke trace-stroke--stage" d="M84 66 C 96 50, 96 30, 84 16" fill="none" strokeWidth="2" strokeLinecap="round" markerEnd={`url(#${tip})`} />
      <path className="trace-stroke trace-stroke--stage trace-stroke--soft" d="M10 92 C 30 98, 50 98, 66 90" fill="none" strokeWidth="2" strokeLinecap="round" markerEnd={`url(#${tip})`} />
    </svg>
  );
}

/* Explosão de setas da celebração: 12 setas curvas em volta do +XP, alternando tangerina e petróleo. */
const BURST: string[] = [
  'M291.4 108.1Q302.1 125.1 327.1 120.2',
  'M265.0 136.2Q262.7 157.1 294.9 162.2',
  'M215.5 153.5Q192.9 167.0 213.4 176.0',
  'M156.2 155.5Q120.9 164.9 128.6 182.2',
  'M103.1 141.5Q69.8 137.9 65.3 151.7',
  'M70.3 115.3Q37.2 103.8 12.7 116.0',
  'M66.6 83.9Q55.9 66.9 30.9 71.8',
  'M93.0 55.8Q95.3 34.9 63.1 29.8',
  'M142.5 38.5Q165.1 25.0 144.6 16.0',
  'M201.8 36.5Q237.1 27.1 229.4 9.8',
  'M254.9 50.5Q288.2 54.1 292.7 40.3',
  'M287.7 76.7Q320.8 88.2 345.3 76.0',
];

/** Celebração da lição concluída: setas que explodem do centro, com o +XP no meio. */
export function TraceBurst({ value, unit, label }: { value: string; unit: string; label: string }) {
  const tipTrace = useSvgId('burst-t');
  const tipHand = useSvgId('burst-m');
  return (
    <svg className="trace-burst" viewBox="0 0 358 192" role="img" aria-label={label}>
      <defs>
        <ArrowMarker id={tipTrace} tone="trace" />
        <ArrowMarker id={tipHand} tone="hand" />
      </defs>
      {BURST.map((d, i) => (
        <path
          key={d}
          className={`trace-burst-ray trace-stroke${i % 2 ? ' trace-stroke--hand' : ''}`}
          style={{ '--i': i } as CSSProperties}
          d={d}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          markerEnd={`url(#${i % 2 ? tipHand : tipTrace})`}
        />
      ))}
      <text className="trace-burst-value" x="179" y="112" textAnchor="middle">{value}</text>
      <text className="trace-burst-unit" x="179" y="136" textAnchor="middle">{unit}</text>
    </svg>
  );
}

/*
 * Mão desenhada pelos 21 pontos do MediaPipe (as mesmas ligações da câmera), na pose do L.
 * Pontos calculados pelo modelo de mão do traco.html. Dedos ativos (polegar e indicador) em tangerina.
 */
const HAND_LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const HAND_L: [number, number][] = [
  [44, 92], [59, 80], [71.9, 78.6], [81.9, 77.6], [90.8, 76.7], [57, 52], [58.2, 35], [59, 24.1], [59.6, 15.1],
  [47, 49], [48.5, 40], [49.6, 51.4], [48.9, 55.9], [37, 52], [37.2, 43.8], [39.6, 54], [39.6, 58.6],
  [28, 58], [27.1, 51.8], [30.5, 59.7], [31.1, 63.7],
];
/** Polegar (1 a 4) e indicador (5 a 8): os dedos que formam o L. */
const isActive = (i: number) => i >= 1 && i <= 8;

export function HandSketchL({ className }: { className?: string }) {
  return (
    <svg className={['hand-sketch', className ?? ''].filter(Boolean).join(' ')} viewBox="5 2 93 97" aria-hidden="true" focusable="false">
      {HAND_LINKS.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          className={`hand-sketch-bone${isActive(b) ? ' is-active' : ''}`}
          x1={HAND_L[a][0]}
          y1={HAND_L[a][1]}
          x2={HAND_L[b][0]}
          y2={HAND_L[b][1]}
        />
      ))}
      {HAND_L.map(([x, y], i) => (
        <circle
          key={i}
          className={`hand-sketch-joint${isActive(i) ? ' is-active' : ''}`}
          cx={x}
          cy={y}
          r={i % 4 === 0 && i > 0 ? 3 : 2.4}
        />
      ))}
    </svg>
  );
}

/** Ilustração das boas-vindas: o L com as setas do movimento, como num dicionário de Libras. */
export function WelcomeIllustration() {
  const tipTrace = useSvgId('boas-t');
  const tipHand = useSvgId('boas-m');
  return (
    <div className="welcome-illustration" aria-hidden="true">
      <svg className="welcome-arcs" viewBox="0 0 350 260" preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <ArrowMarker id={tipTrace} tone="trace" />
          <ArrowMarker id={tipHand} tone="hand" />
        </defs>
        <path className="trace-stroke" d="M40 228 C 40 140, 90 70, 170 46" fill="none" strokeWidth="4" strokeLinecap="round" markerEnd={`url(#${tipTrace})`} />
        <path className="trace-stroke trace-stroke--hand" d="M300 70 C 330 120, 320 190, 270 222" fill="none" strokeWidth="4" strokeLinecap="round" markerEnd={`url(#${tipHand})`} />
        <circle className="trace-start" cx="40" cy="228" r="7" />
      </svg>
      <HandSketchL className="welcome-hand" />
    </div>
  );
}
