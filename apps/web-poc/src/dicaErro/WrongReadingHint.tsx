/*
 * Dica de erro dos exercícios com câmera: a câmera leu outra letra (ou número) no lugar da pedida.
 * Painel no lugar do alvo, acima da câmera (que continua ligada): a mão em 3D do sinal pedido e a do
 * sinal lido, lado a lado, com os dedos que mudam destacados, e uma linha com a diferença, gerada
 * dos dados (dicas-erro.json). Quando a diferença é o movimento, a mão com movimento toca (com menos
 * movimento, só ao tocar no botão). Sem WebGL, sem as poses ou se o 3D falhar: a mesma dica, só em
 * texto. Quando abrir é decidido em gatilho.ts.
 */
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { hasHand3d, isMovingLetter, webglAvailable } from '../mao3d/disponivel';
import { hintTexts, pairHint, type SignKind } from './dicas';
import { HintPair, type PairCaptions } from './HintPair';
import '../styles/dica-erro.css';

const MaosComparadas = lazy(() => import('./MaosComparadas'));

/** Erro ao baixar o pedaço do 3D: fica a dica em texto. */
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

interface Props {
  /** Glosa pedida (K) e a lida pela câmera (H). */
  asked: string;
  read: string;
  kind: SignKind;
  onDismiss: () => void;
  className?: string;
}

export function WrongReadingHint({ asked, read, kind, onDismiss, className }: Props) {
  const { t } = useT();
  const diff = useMemo(() => pairHint(asked, read), [asked, read]);
  const texts = hintTexts(t, asked, read, kind, diff);
  const [failed, setFailed] = useState(false);
  const category = kind === 'number' ? 'numeros' : 'alfabeto';
  const with3d = !failed && webglAvailable()
    && hasHand3d({ category, gloss: asked }) && hasHand3d({ category, gloss: read });
  // Movimento: toca a mão do sinal com movimento (a pedida, se as duas têm)
  const moving = texts.movement ? (isMovingLetter(asked) ? 'asked' : isMovingLetter(read) ? 'read' : null) : null;

  // Região viva vazia na montagem e preenchida logo depois: assim o leitor de tela anuncia
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSpoken(texts.spoken), 150);
    return () => clearTimeout(timer);
  }, [texts.spoken]);

  const captions: PairCaptions = {
    asked: (
      <>
        <span className="wrong-hint-label">{t('wrongHint.askedLabel')}</span>
        <span className="wrong-hint-gloss wrong-hint-gloss--asked">{asked}</span>
      </>
    ),
    read: (
      <>
        <span className="wrong-hint-label">{t('wrongHint.readLabel')}</span>
        <span className="wrong-hint-gloss">{read}</span>
      </>
    ),
  };

  return (
    <section
      className={`wrong-hint${className ? ` ${className}` : ''}`}
      aria-label={t('wrongHint.title', { read })}
      data-pair={`${asked}>${read}`}
    >
      <p className="sr-only" role="status" aria-live="polite">{spoken}</p>
      <div className="wrong-hint-head">
        <Icon name="lightbulb" filled className="wrong-hint-icon" />
        <h2 className="wrong-hint-title">{t('wrongHint.title', { read })}</h2>
        <button type="button" className="wrong-hint-close" onClick={onDismiss} aria-label={t('wrongHint.dismissLabel')}>
          <Icon name="close" />
        </button>
      </div>
      {with3d ? (
        <Boundary onError={() => setFailed(true)}>
          <Suspense fallback={<HintPair captions={captions} stage={() => <div className="wrong-hint-stage" aria-hidden="true" />} />}>
            <MaosComparadas
              asked={asked}
              read={read}
              kind={kind}
              highlight={diff?.d ?? []}
              moving={moving}
              captions={captions}
              onError={() => setFailed(true)}
            />
          </Suspense>
        </Boundary>
      ) : (
        <HintPair captions={captions} />
      )}
      <p className="wrong-hint-line">{texts.line}</p>
      <button type="button" className="btn btn-secondary btn-sm wrong-hint-ok" onClick={onDismiss}>
        {t('wrongHint.dismiss')}
      </button>
    </section>
  );
}
