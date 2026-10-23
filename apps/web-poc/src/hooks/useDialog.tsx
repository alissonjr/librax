import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { Dialog } from '../components/Dialog';

interface DialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface DialogContextValue {
  confirm: (opts: Omit<DialogOptions, 'onConfirm' | 'onCancel'> & {
    onConfirm: () => void;
    onCancel?: () => void;
  }) => void;
  alert: (opts: Omit<DialogOptions, 'cancelLabel' | 'onCancel'> & {
    onConfirm?: () => void;
  }) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<DialogOptions | null>(null);

  const close = useCallback(() => setOpts(null), []);

  const confirm = useCallback((options: DialogOptions & { onConfirm: () => void }) => {
    setOpts(options);
  }, []);

  const alert = useCallback((options: Omit<DialogOptions, 'cancelLabel' | 'onCancel'> & { onConfirm?: () => void }) => {
    setOpts({ ...options });
  }, []);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {opts && (
        <Dialog
          isOpen={true}
          title={opts.title}
          message={opts.message}
          confirmLabel={opts.confirmLabel}
          cancelLabel={opts.cancelLabel}
          onConfirm={() => { close(); opts.onConfirm?.(); }}
          onCancel={opts.onCancel ? () => { close(); opts.onCancel?.(); } : undefined}
        />
      )}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog deve ser usado dentro de DialogProvider');
  return ctx;
}
