import { useState } from 'react';
import { getDisplayName } from '../lib/auth';
import type { IdbRepo } from '../lib/idbRepo';
import { useT, LANGUAGES, type Lang } from '../i18n';
import { getThemePref, setThemePref, type ThemePref } from '../lib/theme';
import { Icon } from '../components/Icon';
import { VlibrasCredit } from '../components/SignDemo';
import { InstallSheet, useInstallMode } from '../components/InstallSheet';

interface Props {
  userId: string;
  repo: IdbRepo;
  onBack: () => void;
}

const GOAL_OPTIONS = [
  { value: 5, key: 'settings.goalCasual' },
  { value: 10, key: 'settings.goalRegular' },
  { value: 20, key: 'settings.goalDedicado' },
  { value: 50, key: 'settings.goalIntensivo' },
];

export function SettingsScreen({ userId, repo, onBack }: Props) {
  const { t, lang, setLang } = useT();
  const [dailyGoal, setDailyGoal] = useState(20);
  const [theme, setTheme] = useState<ThemePref>(getThemePref);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState('');
  const installMode = useInstallMode();
  const [showInstall, setShowInstall] = useState(false);
  const name = getDisplayName() ?? t('common.defaultName');
  const deleteKeyword = t('settings.deleteKeyword');

  async function handleExport() {
    const profile = await repo.getProfile(userId);
    const srsItems = await repo.listSrsItems(userId);
    const data = { profile, srsItems, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `librax-dados-${userId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDeleteAccount() {
    if (deleteInput !== deleteKeyword) return;
    try {
      // Apaga de fato todos os dados locais (perfil, progresso, SRS, XP).
      await repo.clearAllData();
    } catch {
      // Mesmo se a limpeza do IndexedDB falhar, seguimos limpando o
      // localStorage e recarregando para voltar ao onboarding.
    }
    localStorage.clear();
    // Recomeça do início do app (o roteador leva às boas-vindas)
    window.location.replace('/');
  }

  return (
    <div className="sub-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('settings.title')}</h1>
      </div>

      <div className="settings-body">
        <div className="settings-group">
          <p className="settings-group-label">{t('settings.account')}</p>
          <div className="settings-item">
            <Icon name="person" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.name')}</span>
              <span className="settings-item-value">{name}</span>
            </div>
          </div>
        </div>

        <div className="settings-group">
          <p className="settings-group-label">{t('settings.preferences')}</p>
          <div className="settings-item settings-item--select">
            <Icon name="language" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('language.title')}</span>
            </div>
            <select
              className="settings-select"
              value={lang}
              onChange={e => setLang(e.target.value as Lang)}
              aria-label={t('language.select')}
            >
              {LANGUAGES.map(l => (
                <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
              ))}
            </select>
          </div>
          <div className="settings-item settings-item--select">
            <Icon name="contrast" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.theme')}</span>
            </div>
            <select
              className="settings-select"
              value={theme}
              onChange={e => {
                const next = e.target.value as ThemePref;
                setTheme(next);
                setThemePref(next);
              }}
              aria-label={t('settings.theme')}
            >
              <option value="system">{t('settings.themeSystem')}</option>
              <option value="light">{t('settings.themeLight')}</option>
              <option value="dark">{t('settings.themeDark')}</option>
            </select>
          </div>
        </div>

        <div className="settings-group">
          <p className="settings-group-label">{t('settings.learning')}</p>
          <div className="settings-item settings-item--select">
            <Icon name="flag" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.dailyGoal')}</span>
            </div>
            <select
              className="settings-select"
              value={dailyGoal}
              onChange={e => setDailyGoal(Number(e.target.value))}
            >
              {GOAL_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{t(o.key, { xp: o.value })}</option>
              ))}
            </select>
          </div>
          <div className="settings-item">
            <Icon name="videocam" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.cameraForExercises')}</span>
              <span className="settings-item-value">{t('settings.activated')}</span>
            </div>
            <Icon name="chevron_right" className="settings-item-arrow" />
          </div>
        </div>

        <div className="settings-group">
          <p className="settings-group-label">{t('settings.privacy')}</p>
          <button className="settings-item settings-item--btn" onClick={handleExport}>
            <Icon name="download" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.exportData')}</span>
              <span className="settings-item-value">JSON</span>
            </div>
            <Icon name="chevron_right" className="settings-item-arrow" />
          </button>
        </div>

        {installMode && (
          <div className="settings-group">
            <p className="settings-group-label">{t('settings.app')}</p>
            <button className="settings-item settings-item--btn" onClick={() => setShowInstall(true)}>
              <Icon name="mobile_arrow_down" className="settings-item-icon" />
              <div className="settings-item-text">
                <span className="settings-item-label">{t('install.settingsLabel')}</span>
                <span className="settings-item-value">{t('install.settingsValue')}</span>
              </div>
              <Icon name="chevron_right" className="settings-item-arrow" />
            </button>
          </div>
        )}

        <div className="settings-group">
          <p className="settings-group-label">{t('settings.about')}</p>
          <div className="settings-item">
            <Icon name="info" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.version')}</span>
              <span className="settings-item-value">PoC 1.0</span>
            </div>
          </div>
          {/* Crédito e licença do avatar que demonstra os sinais (src/lib/vlibras.ts) */}
          <div className="settings-item">
            <Icon name="sign_language" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('settings.avatarCredit')}</span>
              <VlibrasCredit className="settings-item-value settings-credit" />
            </div>
          </div>
        </div>

        {!showDeleteConfirm ? (
          <button
            className="settings-delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Icon name="delete" /> {t('settings.deleteAccount')}
          </button>
        ) : (
          <div className="settings-delete-confirm">
            <p>
              {t('settings.deleteConfirmInstr').split('{word}')[0]}
              <strong>{deleteKeyword}</strong>
              {t('settings.deleteConfirmInstr').split('{word}')[1]}
            </p>
            <input
              className="settings-delete-input"
              value={deleteInput}
              onChange={e => setDeleteInput(e.target.value)}
              placeholder={deleteKeyword}
              autoComplete="off"
            />
            <div className="settings-delete-actions">
              <button
                className="btn btn-ghost"
                onClick={() => { setShowDeleteConfirm(false); setDeleteInput(''); }}
              >
                {t('common.cancel')}
              </button>
              <button
                className="btn btn-wrong"
                disabled={deleteInput !== deleteKeyword}
                onClick={handleDeleteAccount}
              >
                {t('settings.deleteConfirmBtn')}
              </button>
            </div>
          </div>
        )}
      </div>

      {showInstall && installMode && (
        <InstallSheet mode={installMode} onClose={() => setShowInstall(false)} />
      )}
    </div>
  );
}
