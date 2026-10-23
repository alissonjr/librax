interface Props {
  /** Letra/gesto reconhecido ao vivo (null quando nada e identificado). */
  letter: string | null;
  /** Confianca 0..1 do reconhecimento. */
  confidence: number;
}

/**
 * Mostra em destaque, sobre a mao 3D, a letra reconhecida ao vivo. Atualiza a
 * cada frame conforme a mao muda, dando o feedback de "o app esta me lendo".
 */
export function RecognizedLetterBadge({ letter, confidence }: Props) {
  const pct = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  return (
    <div
      className={`recog-badge${letter ? ' recog-badge--on' : ''}`}
      aria-live="polite"
      aria-label={letter ? `Letra reconhecida: ${letter}` : 'Nenhuma letra reconhecida'}
    >
      <span className="recog-badge-letter">{letter ?? '·'}</span>
      <div className="recog-badge-meter">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
