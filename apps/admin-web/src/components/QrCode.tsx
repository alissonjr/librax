import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

/** Margem branca em volta (em módulos): os leitores precisam de 4. */
const QUIET_ZONE = 4;

/** Caminho SVG dos módulos escuros do QR code (um quadrado de 1x1 por módulo). */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return { size: count + QUIET_ZONE * 2, d: parts.join('') };
}

/**
 * QR code gerado no navegador, em SVG (nada vai para fora; a CSP do painel não precisa de data: nem
 * de host novo). Sempre escuro no claro, nos dois temas: é o que os leitores entendem.
 */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg className="qr" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect className="qr-bg" width={size} height={size} />
      <path className="qr-fg" d={d} />
    </svg>
  );
}
