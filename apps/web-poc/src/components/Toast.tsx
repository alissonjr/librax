import { useEffect } from 'react';

/** Tempo na tela (design-system 11.12: 4 s sem ação). */
const TOAST_MS = 4000;

interface Props {
  message: string;
  onDone: () => void;
}

/**
 * Aviso discreto (design-system 11.12): `bg.inverse` e `text.inverse`, acima da barra de abas e da
 * safe area, some sozinho em 4 s. `role="status"` para o leitor de tela anunciar sem roubar o foco.
 */
export function Toast({ message, onDone }: Props) {
  useEffect(() => {
    const timer = window.setTimeout(onDone, TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);

  return (
    <div className="toast animate__animated animate__fadeInUp animate__faster" role="status">
      {message}
    </div>
  );
}
