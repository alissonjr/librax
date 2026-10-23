import { lazy, Suspense } from 'react';
import type { Lm } from '../lib/recognizer';

/**
 * Fronteira de code-split do avatar 3D: o three.js (~600KB) so e baixado
 * quando uma tela de camera monta este componente, mantendo o carregamento
 * inicial do app leve (mesmo padrao do MediaPipe em useCameraRecognizer).
 */
const Impl = lazy(() =>
  import('./HandAvatar3DCanvas').then(m => ({ default: m.HandAvatar3DCanvas })),
);

interface Props {
  landmarksRef: React.RefObject<Lm[] | null>;
  className?: string;
}

export function HandAvatar3D(props: Props) {
  return (
    <Suspense fallback={null}>
      <Impl {...props} />
    </Suspense>
  );
}
