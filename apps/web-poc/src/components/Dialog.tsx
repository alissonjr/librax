import { useT } from '../i18n';
import { Icon } from './Icon';

interface DialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export function Dialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: DialogProps) {
  const { t } = useT();
  if (!isOpen) return null;

  const icon = onCancel ? 'warning' : 'info';
  const resolvedConfirmLabel = confirmLabel ?? t('dialog.ok');

  return (
    <div className="dialog-overlay animate__animated animate__fadeIn animate__faster" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="dialog-box animate__animated animate__zoomIn animate__faster">
        <div className={`dialog-icon${onCancel ? ' dialog-icon--warning' : ''}`}>
          <Icon name={icon} filled size="32px" />
        </div>
        <h2 className="dialog-title" id="dialog-title">{title}</h2>
        <p className="dialog-message">{message}</p>
        <div className="dialog-actions">
          {onCancel && cancelLabel && (
            <button className="btn btn-secondary" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button className="btn btn-primary" onClick={onConfirm}>
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
