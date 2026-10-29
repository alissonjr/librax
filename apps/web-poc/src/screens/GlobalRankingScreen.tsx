import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { SimpleRanking, type SimpleRow } from '../components/SimpleRanking';
import { SocialAccountInvite, SocialOffline } from '../components/SocialAccountInvite';
import { getDisplayName } from '../lib/auth';
import { useAccount } from '../lib/account';
import { fetchGlobalRanking, type GlobalRanking, type Load } from '../lib/social';
import '../styles/league.css';

interface Props {
  onBack: () => void;
  onAccount: (mode: 'register' | 'login') => void;
  onOpenSettings: () => void;
}

/**
 * Liga geral: todo mundo com conta, pelo XP total de sempre (top 50 e a sua posição, mesmo fora
 * dele). Quem desligou "Aparecer na liga geral" em Configurações não entra na lista.
 */
export function GlobalRankingScreen({ onBack, onAccount, onOpenSettings }: Props) {
  const { t } = useT();
  const account = useAccount();
  const [load, setLoad] = useState<Load<GlobalRanking> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (account.status === 'checking') return;
    if (account.status !== 'signedIn') {
      setLoad({ kind: 'guest' });
      return;
    }
    let alive = true;
    setLoad(null);
    fetchGlobalRanking().then(l => {
      if (alive) setLoad(l);
    });
    return () => {
      alive = false;
    };
  }, [account.status, attempt]);

  const data = load?.kind === 'ok' ? load.data : null;
  const myName = getDisplayName() ?? t('common.defaultName');
  const rows: SimpleRow[] = (data?.top ?? []).map((r, i) => ({
    key: `${r.rank}-${i}`,
    rank: r.rank,
    name: r.isYou ? myName : r.name?.trim() || t('league.anonymousName'),
    xp: r.xp,
    isYou: r.isYou,
  }));
  const youInTop = rows.some(r => r.isYou);

  return (
    <div className="sub-screen league-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('globalLeague.title')}</h1>
      </div>

      <div className="league-body">
        {load === null && <p className="text-muted league-loading">{t('common.loading')}</p>}
        {load?.kind === 'guest' && (
          <SocialAccountInvite
            text={t('globalLeague.guestText')}
            onCreateAccount={() => onAccount('register')}
            onLogin={() => onAccount('login')}
          />
        )}
        {load?.kind === 'offline' && <SocialOffline onRetry={() => setAttempt(a => a + 1)} />}

        {data && (
          <>
            <p className="social-lead">{t('globalLeague.lead')}</p>

            {data.you.listed && data.you.rank !== null && !youInTop && (
              <div className="social-you-card">
                <span className="social-you-rank tabular">{t('league.rowPlace', { rank: data.you.rank })}</span>
                <span className="social-you-xp tabular">{t('league.xp', { xp: data.you.xp })}</span>
              </div>
            )}

            {rows.length > 0
              ? <SimpleRanking rows={rows} label={t('globalLeague.rankingLabel')} />
              : <p className="text-muted league-loading">{t('globalLeague.empty')}</p>}

            {!data.you.listed && (
              <p className="league-demo-note">
                <Icon name="visibility_off" />
                <span>
                  {t('globalLeague.hiddenNote')}{' '}
                  <button className="btn-text" onClick={onOpenSettings}>{t('globalLeague.hiddenAction')}</button>
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
