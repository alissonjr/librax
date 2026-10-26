import type { ReactNode } from 'react';

export interface PairCaptions {
  asked: ReactNode;
  read: ReactNode;
}

/** As duas colunas da dica de erro (sinal pedido e sinal lido); `stage` desenha a mão de cada uma, se houver. */
export function HintPair({ captions, stage }: { captions: PairCaptions; stage?: (which: 'asked' | 'read') => ReactNode }) {
  return (
    <div className="wrong-hint-pair">
      {(['asked', 'read'] as const).map((which) => (
        <figure key={which} className={`wrong-hint-hand wrong-hint-hand--${which}`}>
          {stage?.(which)}
          <figcaption>{captions[which]}</figcaption>
        </figure>
      ))}
    </div>
  );
}
