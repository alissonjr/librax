/*
 * Mão em 3D pequena, sem controles próprios, para pôr duas lado a lado (contrast_pair, "Mãos
 * parecidas"). Carregada sob demanda, como a Mao3DView. Quem chama decide se o movimento toca
 * (`playing`); a mão parada fica de frente, sem o giro automático, para a comparação das duas formas.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { getSkinTone, prefersReducedMotion } from './disponivel';
import { clipFor } from './poses';
import { createMotor, type Motor } from './motor';
import { loadHandModel } from './Mao3DView';

interface Props {
  gloss: string;
  /** Toca o movimento (só nas letras com movimento; a mão parada não gira). */
  playing: boolean;
  /** Descrição da mão para o leitor de tela (sem o nome do sinal na checagem). */
  label: string;
  /** Qual das pessoas dos dados (a checagem mostra outra mão, não a mesma foto da comparação). */
  person?: number;
  /** Sem 3D (falhou, sem GPU, contexto perdido): quem chamou mostra a descrição. */
  onError: () => void;
}

export default function Mao3DMini({ gloss, playing, label, person = 0, onError }: Props) {
  const { t } = useT();
  const clip = useMemo(() => clipFor(gloss), [gloss]);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const motorRef = useRef<Motor | null>(null);
  const [ready, setReady] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const moving = !!clip?.moving;
  const playingRef = useRef(playing);
  playingRef.current = playing;

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
          playing: moving && playingRef.current,
          speed: 1,
          onLost: () => onErrorRef.current(),
        });
        if (!alive) {
          motor.dispose();
          return;
        }
        motorRef.current = motor;
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

  useEffect(() => { motorRef.current?.setPlaying(moving && playing); }, [moving, playing, ready]);
  useEffect(() => {
    if (clip?.people.length) motorRef.current?.setPerson(person % clip.people.length);
  }, [clip, person, ready]);

  if (!clip) return null;

  return (
    <div ref={stageRef} className="mao3d-mini" data-ready={ready || undefined}>
      <canvas ref={canvasRef} className="mao3d-canvas" role="img" aria-label={label} />
      {!ready && (
        <div className="mao3d-mini-loading" aria-hidden="true">
          <Icon name="progress_activity" spin size="24px" />
          <span className="sr-only">{t('mao3d.loading')}</span>
        </div>
      )}
    </div>
  );
}
