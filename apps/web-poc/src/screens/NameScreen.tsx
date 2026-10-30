import { useState, type FormEvent } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { getDisplayName } from '../lib/auth';
import { cleanName, renameDisplayName, DISPLAY_NAME_MAX, type RenameResult } from '../lib/social';

interface Props {
  onBack: () => void;
  /** Depois de salvar: o aviso (chave de tradução) e a volta para Configurações. */
  onSaved: (notice: string) => void;
}

const NOTICE: Record<RenameResult, string> = {
  saved: 'nameScreen.saved',
  local: 'nameScreen.savedLocal',
  pending: 'nameScreen.savedPending',
};

/**
 * Trocar o nome (Configurações > Nome): o mesmo campo das boas-vindas, até 30 caracteres. Com
 * conta, o nome novo vai para o servidor e aparece nas ligas (da semana, geral e privadas).
 */
export function NameScreen({ onBack, onSaved }: Props) {
  const { t } = useT();
  const current = getDisplayName() ?? '';
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const name = cleanName(value);
  const changed = !!name && name !== current;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!changed || busy) return;
    setBusy(true);
    const result = await renameDisplayName(value);
    setBusy(false);
    if (result) onSaved(NOTICE[result]);
  };

  return (
    <div className="sub-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('nameScreen.title')}</h1>
      </div>

      <form className="settings-body name-form" onSubmit={submit} noValidate>
        <label className="auth-label" htmlFor="name-input">{t('nameScreen.label')}</label>
        <input
          id="name-input"
          className="auth-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          autoComplete="given-name"
          aria-describedby="name-hint"
          aria-invalid={value.trim() === '' ? true : undefined}
        />
        <p id="name-hint" className="text-muted">{t('nameScreen.hint')}</p>
        <button type="submit" className="btn btn-primary" disabled={!changed || busy}>
          {busy ? t('common.loading') : t('nameScreen.save')}
        </button>
      </form>
    </div>
  );
}
