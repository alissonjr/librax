import { useT } from '../i18n';
import { Icon } from './Icon';
import { useCloseOnBack } from '../hooks/useCloseOnBack';

interface DialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  /**
   * Voltar fecha o diálogo (design-system 11.13): como "Cancelar" quando há, senão como o botão
   * único. Desligado no "Sair da lição?", que já nasce de um voltar (useLessonExit).
   */
  closeOnBack?: boolean;
}

export function Dialog({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  closeOnBack = true,
}: DialogProps) {
  const { t } = useT();
  useCloseOnBack(isOpen && closeOnBack, onCancel ?? onConfirm);
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
