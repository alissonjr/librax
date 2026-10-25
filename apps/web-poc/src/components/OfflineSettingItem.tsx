import { useEffect, useState } from 'react';
import {
  canStoreOffline, checkDownload, downloadPercent, runDownload, useDownload, type AssetFile,
} from '../lib/assetDownload';
import { offlineFiles } from '../lib/offlinePack';
import { useT } from '../i18n';
import { Icon } from './Icon';

/** MB arredondados para o texto (nunca "0 MB" quando ainda falta algo). */
function mb(bytes: number): number {
  return bytes > 0 ? Math.max(1, Math.round(bytes / 1_000_000)) : 0;
}

/**
 * "Baixar para usar offline" nas Configurações: câmera e avatar VLibras (motor e as animações do
 * curso) no cache do service worker. Mostra o tamanho antes, o progresso durante e o estado final.
 */
export function OfflineSettingItem() {
  const { t } = useT();
  const state = useDownload('offline');
  const [files, setFiles] = useState<AssetFile[] | null>(null);
  const supported = canStoreOffline();

  // Lista e o que já está guardado (quem já baixou vê "Pronto para usar offline" direto)
  useEffect(() => {
    let alive = true;
    offlineFiles().then(list => {
      if (!alive) return;
      setFiles(list);
      if (supported) void checkDownload('offline', list);
    }).catch(() => {});
    return () => { alive = false; };
  }, [supported]);

  const total = files ? files.reduce((s, f) => s + f.bytes, 0) : 0;
  const pct = downloadPercent(state);
  const downloading = state.status === 'downloading';
  const checking = state.status === 'checking' || !files;
  const done = state.status === 'done';

  let label = t('offline.label');
  let value: string;
  if (!supported) value = t('offline.unsupported');
  else if (done) {
    label = t('offline.done');
    value = t('offline.doneHint');
  } else if (downloading) {
    label = t('offline.downloadingLabel');
    value = t('offline.downloading', { pct, done: mb(state.loaded), total: mb(state.total) });
  } else if (checking) value = t('offline.checking');
  else if (state.status === 'error') value = t(state.error === 'offline' ? 'offline.errorOffline' : 'offline.error');
  else if (state.loaded > 0) value = t('offline.remaining', { mb: mb(state.total - state.loaded) });
  else value = t('offline.hint', { mb: mb(total) });

  const content = (
    <>
      <Icon name={done ? 'cloud_done' : 'download'} className="settings-item-icon" />
      <div className="settings-item-text">
        <span className="settings-item-label">{label}</span>
        <span className="settings-item-value">{value}</span>
        {downloading && (
          <div
            className="progress-bar-wrap progress-bar-wrap--goal offline-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={label}
          >
            <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </>
  );

  // Pronto ou sem suporte: só informa, não é botão
  if (done || !supported) return <div className="settings-item">{content}</div>;
  return (
    <button
      className="settings-item settings-item--btn"
      onClick={() => { if (files) void runDownload('offline', files); }}
      disabled={checking || downloading}
      aria-busy={checking || downloading || undefined}
    >
      {content}
    </button>
  );
}
