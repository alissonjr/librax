import { downloadPercent, useDownload } from '../lib/assetDownload';
import { useT } from '../i18n';
import { Icon } from './Icon';

/**
 * Selo discreto no mapa enquanto os arquivos da câmera baixam em segundo plano
 * (lib/assetDownload.ts). Some sozinho ao terminar; não bloqueia nada.
 */
export function CameraPrepChip() {
  const { t } = useT();
  const state = useDownload('camera');
  if (state.status !== 'downloading') return null;
  return (
    <p className="prep-chip">
      <Icon name="videocam" filled className="prep-chip-icon" />
      <span>{t('offline.cameraChip', { pct: downloadPercent(state) })}</span>
    </p>
  );
}
