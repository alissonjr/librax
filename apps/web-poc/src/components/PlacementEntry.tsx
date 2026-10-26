import { useEffect, useState } from 'react';
import type { IdbRepo } from '../lib/idbRepo';
import { loadPlacementStatus, undoPlacement, type PlacementStatus } from '../lib/placement';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { Dialog } from './Dialog';
import '../styles/placement.css';

/**
 * Entradas do teste de nivelamento fora do onboarding (lib/placement.ts): o convite discreto no
 * começo da unidade 1 do mapa e o item das Configurações (fazer o teste ou desfazê-lo). Ignorar é
 * só não tocar: nada aqui bloqueia a lição seguinte.
 */

/** Convite no mapa, logo abaixo do cabeçalho da unidade 1. */
export function PlacementInvite({ onOpen }: { onOpen: () => void }) {
  const { t } = useT();
  return (
    <div className="placement-invite" role="note">
      <Icon name="sign_language" className="placement-invite-icon" />
      <div className="placement-invite-text">
        <strong>{t('placement.inviteTitle')}</strong>
        <span>{t('placement.inviteText')}</span>
      </div>
      <button type="button" className="btn btn-secondary btn-sm placement-invite-btn" onClick={onOpen}>
        {t('placement.inviteAction')}
      </button>
    </div>
  );
}

interface SettingProps {
  repo: IdbRepo;
  userId: string;
  onOpen: () => void;
  /** Aviso discreto depois de desfazer (chave de tradução). */
  onNotice?: (key: string) => void;
}

/** Configurações > Aprendizado: "Teste de nivelamento" enquanto vale, ou "Desfazer" com lições puladas. */
export function PlacementSettingItem({ repo, userId, onOpen, onNotice }: SettingProps) {
  const { t } = useT();
  const [status, setStatus] = useState<PlacementStatus | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadPlacementStatus(repo, userId).then(s => { if (alive) setStatus(s); }).catch(() => {});
    return () => { alive = false; };
  }, [repo, userId]);

  if (!status) return null;

  async function undo() {
    setConfirm(false);
    setBusy(true);
    try {
      await undoPlacement(repo, userId);
      setStatus(await loadPlacementStatus(repo, userId));
      onNotice?.('placement.undone');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {status.offer && (
        <button className="settings-item settings-item--btn" onClick={onOpen}>
          <Icon name="sign_language" className="settings-item-icon" />
          <div className="settings-item-text">
            <span className="settings-item-label">{t('placement.settingsLabel')}</span>
            <span className="settings-item-value">{t('placement.settingsHint')}</span>
          </div>
          <Icon name="chevron_right" className="settings-item-arrow" />
        </button>
      )}
      {status.placed.length > 0 && (
        <button className="settings-item settings-item--btn" onClick={() => setConfirm(true)} disabled={busy} aria-busy={busy || undefined}>
          <Icon name="restart_alt" className="settings-item-icon" />
          <div className="settings-item-text">
            <span className="settings-item-label">{t('placement.undoLabel')}</span>
            <span className="settings-item-value">{t('placement.undoHint', { count: status.placed.length })}</span>
          </div>
        </button>
      )}
      <Dialog
        isOpen={confirm}
        title={t('placement.undoTitle')}
        message={t('placement.undoMessage')}
        confirmLabel={t('placement.undoConfirm')}
        cancelLabel={t('common.cancel')}
        onConfirm={undo}
        onCancel={() => setConfirm(false)}
      />
    </>
  );
}
