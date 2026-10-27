import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { BusyLabel } from './BusyLabel';
import {
  REMINDER_HOURS,
  currentAccountId,
  emailRemindersAvailable,
  loadReminderPrefs,
  pushSupport,
  remindersAvailable,
  setEmailReminders,
  setPushReminders,
  setReminderHour,
  type ReminderPrefs,
  type ReminderResult,
} from '../lib/reminders';
import '../styles/sound.css';

interface Props {
  signedIn: boolean;
  onOpenAccount?: (mode: 'login' | 'register') => void;
  onNotice?: (key: string) => void;
}

type Busy = 'push' | 'email' | 'hour' | null;

/** "19:00" ou "7:00 PM", no idioma do app. */
function hourLabel(hour: number, lang: string): string {
  try {
    return new Date(2000, 0, 1, hour).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return `${hour}:00`;
  }
}

/**
 * Grupo "Lembretes" das Configurações (lib/reminders.ts): notificação no celular, e-mail e horário.
 * Só aparece quando o build tem algum dos dois ligado. Sem conta, convida a criar uma. Os
 * interruptores seguem o do som: o texto diz o estado, não só a posição.
 */
export function ReminderSettings({ signedIn, onOpenAccount, onNotice }: Props) {
  const { t, lang } = useT();
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [support, setSupport] = useState(pushSupport);

  // Escolhas guardadas da conta conectada (outra conta neste navegador começa do zero)
  useEffect(() => {
    let alive = true;
    if (!signedIn || !remindersAvailable()) {
      setPrefs(null);
      return;
    }
    void currentAccountId().then(id => {
      if (alive) setPrefs(id ? loadReminderPrefs(id) : null);
    });
    return () => { alive = false; };
  }, [signedIn]);

  if (!remindersAvailable()) return null;
  // Com conta, até ler as escolhas: o grupo fica com o título, sem pular de lugar
  if (signedIn && !prefs) {
    return (
      <div className="settings-group">
        <p className="settings-group-label">{t('reminders.title')}</p>
      </div>
    );
  }
  const current = signedIn ? prefs : null;

  async function run(kind: Busy, action: () => Promise<ReminderResult>) {
    if (busy) return;
    setBusy(kind);
    const result = await action();
    setBusy(null);
    setSupport(pushSupport());
    if (result.ok) setPrefs(result.prefs);
    else onNotice?.(`reminders.errors.${result.error}`);
  }

  return (
    <div className="settings-group">
      <p className="settings-group-label">{t('reminders.title')}</p>
      {!current ? (
        onOpenAccount && (
          <button className="settings-item settings-item--btn" onClick={() => onOpenAccount('register')}>
            <Icon name="notifications" className="settings-item-icon" />
            <div className="settings-item-text">
              <span className="settings-item-label">{t('reminders.title')}</span>
              <span className="settings-item-value">{t('reminders.guestHint')}</span>
            </div>
            <Icon name="chevron_right" className="settings-item-arrow" />
          </button>
        )
      ) : (
        <>
          {support === 'ok' || (support === 'denied' && current.push) ? (
            <button
              type="button"
              role="switch"
              aria-checked={current.push}
              className="settings-item settings-item--btn sound-setting"
              disabled={busy !== null}
              aria-busy={busy === 'push' || undefined}
              onClick={() => void run('push', () => setPushReminders(!current.push))}
            >
              <Icon name="notifications" className="settings-item-icon" />
              <span className="settings-item-text">
                <span className="settings-item-label">{t('reminders.push')}</span>
                <span className="settings-item-value">
                  {current.push ? t('reminders.on') : t('reminders.off')}. {t('reminders.pushHint')}
                </span>
              </span>
              {busy === 'push' ? (
                <BusyLabel text={t('account.sending')} />
              ) : (
                <span className={`sound-switch${current.push ? ' sound-switch--on' : ''}`} aria-hidden="true">
                  <span className="sound-switch-thumb" />
                </span>
              )}
            </button>
          ) : support === 'install' || support === 'denied' ? (
            <div className="settings-item">
              <Icon name="notifications_off" className="settings-item-icon" />
              <div className="settings-item-text">
                <span className="settings-item-label">{t('reminders.push')}</span>
                <span className="settings-item-value">
                  {t(support === 'install' ? 'reminders.pushInstall' : 'reminders.pushDenied')}
                </span>
              </div>
            </div>
          ) : null}
          {emailRemindersAvailable() && (
            <button
              type="button"
              role="switch"
              aria-checked={current.email}
              className="settings-item settings-item--btn sound-setting"
              disabled={busy !== null}
              aria-busy={busy === 'email' || undefined}
              onClick={() => void run('email', () => setEmailReminders(!current.email))}
            >
              <Icon name="mail" className="settings-item-icon" />
              <span className="settings-item-text">
                <span className="settings-item-label">{t('reminders.email')}</span>
                <span className="settings-item-value">
                  {current.email ? t('reminders.on') : t('reminders.off')}. {t('reminders.emailHint')}
                </span>
              </span>
              {busy === 'email' ? (
                <BusyLabel text={t('account.sending')} />
              ) : (
                <span className={`sound-switch${current.email ? ' sound-switch--on' : ''}`} aria-hidden="true">
                  <span className="sound-switch-thumb" />
                </span>
              )}
            </button>
          )}
          {(current.push || current.email) && (
            <div className="settings-item settings-item--select">
              <Icon name="schedule" className="settings-item-icon" />
              <div className="settings-item-text">
                <span className="settings-item-label">{t('reminders.hour')}</span>
              </div>
              <select
                className="settings-select"
                value={current.hour}
                disabled={busy !== null}
                onChange={e => void run('hour', () => setReminderHour(Number(e.target.value)))}
                aria-label={t('reminders.hour')}
              >
                {REMINDER_HOURS.map(h => (
                  <option key={h} value={h}>{hourLabel(h, lang)}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
