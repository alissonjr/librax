import { useCallback, useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { Dialog } from '../components/Dialog';
import { SimpleRanking, type SimpleRow } from '../components/SimpleRanking';
import { SocialOffline } from '../components/SocialAccountInvite';
import { getDisplayName } from '../lib/auth';
import {
  copyText, deletePrivateLeague, fetchPrivateLeague, inviteLink, leavePrivateLeague, newInviteCode,
  shareInvite, whatsappLink, type Load, type PrivateLeagueDetail,
} from '../lib/social';
import '../styles/league.css';

interface Props {
  leagueId: string;
  onBack: () => void;
  /** Depois de sair ou apagar a liga. */
  onGone: () => void;
  showNotice: (key: string) => void;
  /** Recém-criada: o convite já aparece aberto. */
  justCreated?: boolean;
}

type Tab = 'week' | 'total';

/** Ranking da liga na aba: XP da semana (zera toda segunda) ou desde que cada pessoa entrou. */
export function privateRows(
  detail: PrivateLeagueDetail,
  tab: Tab,
  myName: string,
  anonymous: string,
  myId: string | null,
): SimpleRow[] {
  const xpOf = (m: PrivateLeagueDetail['members'][number]) => (tab === 'week' ? m.xpWeeklyContrib : m.xpAllTimeContrib) ?? 0;
  const sorted = [...detail.members].sort((a, b) => xpOf(b) - xpOf(a) || (a.userId < b.userId ? -1 : 1));
  let rank = 0;
  let lastXp: number | null = null;
  return sorted.map((m, i) => {
    const xp = xpOf(m);
    // Empate divide a posição (1, 2, 2, 4)
    if (xp !== lastXp) rank = i + 1;
    lastXp = xp;
    const isYou = m.userId === myId;
    return { key: m.userId, rank, name: isYou ? myName : m.displayName?.trim() || anonymous, xp, isYou };
  });
}

/**
 * Liga privada (squad privada do servidor): código de convite com Copiar, Compartilhar e WhatsApp,
 * ranking da semana e total, e sair (ou, para quem criou, apagar a liga).
 */
export function PrivateLeagueScreen({ leagueId, onBack, onGone, showNotice, justCreated = false }: Props) {
  const { t } = useT();
  const [load, setLoad] = useState<Load<PrivateLeagueDetail> | { kind: 'missing' } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('week');
  const [confirm, setConfirm] = useState<'leave' | 'delete' | 'code' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoad(null);
    fetchPrivateLeague(leagueId).then(l => {
      if (alive) setLoad(l);
    });
    return () => {
      alive = false;
    };
  }, [leagueId, attempt]);

  const detail = load?.kind === 'ok' ? load.data : null;
  const isMember = !!detail?.userMembership;
  const isAdmin = detail?.userMembership?.role === 'admin';
  const code = detail?.squad.inviteCode ?? null;
  const name = detail?.squad.name ?? t('privateLeague.title');

  const shareText = t('privateLeague.shareText', { name, code: code ?? '' });

  const share = useCallback(async () => {
    if (!code) return;
    const out = await shareInvite(shareText, inviteLink(code));
    if (out === 'copied') showNotice('privateLeague.linkCopied');
  }, [code, shareText, showNotice]);

  const copy = useCallback(async () => {
    if (!code) return;
    showNotice((await copyText(code)) ? 'privateLeague.codeCopied' : 'privateLeague.copyFailed');
  }, [code, showNotice]);

  const runConfirmed = async () => {
    const action = confirm;
    setConfirm(null);
    if (!action) return;
    setBusy(true);
    try {
      if (action === 'code') {
        const res = await newInviteCode(leagueId);
        if (res.ok) {
          setAttempt(a => a + 1);
          showNotice('privateLeague.codeChanged');
        } else showNotice(res.code === 'OFFLINE' ? 'social.offlineTitle' : 'privateLeague.actionFailed');
        return;
      }
      const res = action === 'leave' ? await leavePrivateLeague(leagueId) : await deletePrivateLeague(leagueId);
      if (res.ok) {
        showNotice(action === 'leave' ? 'privateLeague.left' : 'privateLeague.deleted');
        onGone();
      } else if (res.code === 'MUST_TRANSFER_OWNERSHIP') {
        showNotice('privateLeague.ownerMustDelete');
      } else showNotice(res.code === 'OFFLINE' ? 'social.offlineTitle' : 'privateLeague.actionFailed');
    } finally {
      setBusy(false);
    }
  };

  const myName = getDisplayName() ?? t('common.defaultName');
  const rows = detail ? privateRows(detail, tab, myName, t('league.anonymousName'), detail.me ?? null) : [];

  return (
    <div className="sub-screen league-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{name}</h1>
      </div>

      <div className="league-body">
        {load === null && <p className="text-muted league-loading">{t('common.loading')}</p>}
        {(load?.kind === 'offline' || load?.kind === 'guest') && <SocialOffline onRetry={() => setAttempt(a => a + 1)} />}
        {(load?.kind === 'missing' || (detail && !isMember)) && (
          <p className="text-muted league-loading">{t('privateLeague.missing')}</p>
        )}

        {detail && isMember && (
          <>
            <p className="social-lead">
              {t('privateLeague.members', { n: detail.squad.memberCount, max: detail.squad.maxMembers })}
            </p>

            {code && (
              <section className={`private-invite${justCreated ? ' private-invite--new' : ''}`} aria-labelledby="private-invite-title">
                <h2 id="private-invite-title" className="private-invite-title">
                  {justCreated ? t('privateLeague.createdInvite') : t('privateLeague.inviteTitle')}
                </h2>
                <div className="private-invite-code">
                  <span className="private-invite-code-value tabular" aria-label={t('privateLeague.codeLabel', { code: code.split('').join(' ') })}>{code}</span>
                  <button className="btn btn-ghost btn-sm" onClick={copy}>
                    <Icon name="content_copy" /> {t('privateLeague.copy')}
                  </button>
                </div>
                <div className="private-invite-actions">
                  <button className="btn btn-primary" onClick={share}>
                    <Icon name="share" /> {t('privateLeague.share')}
                  </button>
                  <a
                    className="btn btn-secondary"
                    href={whatsappLink(`${shareText} ${inviteLink(code)}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('privateLeague.whatsapp')}
                  </a>
                </div>
              </section>
            )}

            <div className="private-tabs" role="radiogroup" aria-label={t('privateLeague.tabsLabel')}>
              {(['week', 'total'] as Tab[]).map(k => (
                <button
                  key={k}
                  className="private-tab"
                  role="radio"
                  aria-checked={tab === k}
                  onClick={() => setTab(k)}
                >
                  {k === 'week' ? t('privateLeague.tabWeek') : t('privateLeague.tabTotal')}
                </button>
              ))}
            </div>
            <p className="text-muted private-tab-hint">
              {tab === 'week' ? t('privateLeague.weekHint') : t('privateLeague.totalHint')}
            </p>

            <SimpleRanking rows={rows} label={t('privateLeague.rankingLabel', { name })} />

            <div className="private-manage">
              {isAdmin && code && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirm('code')}>
                  <Icon name="autorenew" /> {t('privateLeague.newCode')}
                </button>
              )}
              {isAdmin ? (
                <button className="btn btn-ghost private-danger" disabled={busy} onClick={() => setConfirm('delete')}>
                  <Icon name="delete" /> {t('privateLeague.delete')}
                </button>
              ) : (
                <button className="btn btn-ghost private-danger" disabled={busy} onClick={() => setConfirm('leave')}>
                  <Icon name="logout" /> {t('privateLeague.leave')}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <Dialog
        isOpen={confirm !== null}
        title={
          confirm === 'delete' ? t('privateLeague.deleteTitle', { name })
            : confirm === 'code' ? t('privateLeague.newCodeTitle')
              : t('privateLeague.leaveTitle', { name })
        }
        message={
          confirm === 'delete' ? t('privateLeague.deleteText')
            : confirm === 'code' ? t('privateLeague.newCodeText', { code: code ?? '' })
              : t('privateLeague.leaveText')
        }
        confirmLabel={
          confirm === 'delete' ? t('privateLeague.delete')
            : confirm === 'code' ? t('privateLeague.newCode')
              : t('privateLeague.leave')
        }
        cancelLabel={t('common.cancel')}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
