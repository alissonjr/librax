import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import type { IdbRepo } from '../lib/idbRepo';
import { Icon } from '../components/Icon';

interface Props {
  userId: string;
  repo: IdbRepo;
  onBack: () => void;
}

interface AchievementDef {
  code: string;
  key: string;
  icon: string;
}

const ALL_ACHIEVEMENTS: AchievementDef[] = [
  { code: 'PRIMEIRA_LICAO', key: 'primeiraLicao', icon: 'L1' },
  { code: 'SEQUENCIA_3', key: 'sequencia3', icon: 'S3' },
  { code: 'SEQUENCIA_7', key: 'sequencia7', icon: 'S7' },
  { code: 'SEQUENCIA_30', key: 'sequencia30', icon: 'S30' },
  { code: 'SINAIS_5', key: 'sinais5', icon: 'X5' },
  { code: 'SINAIS_10', key: 'sinais10', icon: 'X10' },
  { code: 'SINAIS_26', key: 'sinais26', icon: 'AZ' },
  { code: 'U1_COMPLETA', key: 'u1Completa', icon: 'U1' },
  { code: 'U2_COMPLETA', key: 'u2Completa', icon: 'U2' },
  { code: 'U3_COMPLETA', key: 'u3Completa', icon: 'U3' },
  { code: 'U4_COMPLETA', key: 'u4Completa', icon: 'U4' },
  { code: 'U5_COMPLETA', key: 'u5Completa', icon: 'U5' },
  { code: 'U6_COMPLETA', key: 'u6Completa', icon: 'A1' },
  { code: 'META_7', key: 'meta7', icon: 'M7' },
  { code: 'META_30', key: 'meta30', icon: 'M30' },
  { code: 'CAMERA_ESTREANTE', key: 'cameraEstreante', icon: 'CAM' },
  { code: 'SRS_INICIO', key: 'srsInicio', icon: 'SRS' },
  { code: 'SRS_MESTRE', key: 'srsMestre', icon: 'S50' },
  { code: 'PERFEITO_MC4', key: 'perfeitoMc4', icon: '100' },
  { code: 'PARES_MESTRE', key: 'paresMestre', icon: 'PAR' },
  { code: 'MADRUGADOR', key: 'madrugador', icon: 'MAD' },
  { code: 'NOTURNO', key: 'noturno', icon: 'NOT' },
  { code: 'VELOCISTA', key: 'velocista', icon: 'VEL' },
  { code: 'COMUNIDADE', key: 'comunidade', icon: 'LBX' },
];

export function AchievementsScreen({ userId, repo, onBack }: Props) {
  const { t } = useT();
  const [earned, setEarned] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function load() {
      const profile = await repo.getProfile(userId) as Record<string, unknown> | null;
      const achievements = (profile?.achievements as string[]) ?? [];
      setEarned(new Set(achievements));
    }
    load();
  }, [userId, repo]);

  const unlocked = ALL_ACHIEVEMENTS.filter(a => earned.has(a.code));
  const locked   = ALL_ACHIEVEMENTS.filter(a => !earned.has(a.code));

  return (
    <div className="sub-screen">
      <div className="sub-screen-bar">
        <button className="back-btn" onClick={onBack} aria-label={t('common.back')}>
          <Icon name="arrow_back" />
        </button>
        <h1>{t('achievementsScreen.title')}</h1>
        <span className="ach-counter">{unlocked.length} / {ALL_ACHIEVEMENTS.length}</span>
      </div>

      <div className="ach-body">
        {unlocked.length > 0 && (
          <>
            <p className="ach-section-label">{t('achievementsScreen.unlocked')}</p>
            {unlocked.map((a, i) => (
              <div
                key={a.code}
                className="ach-tile ach-tile--unlocked animate__animated animate__fadeInUp animate__faster"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="ach-tile-icon ach-tile-icon--badge ach-tile-icon--earned">{a.icon}</div>
                <div className="ach-tile-text">
                  <div className="ach-tile-title">{t(`achievementsScreen.ach_${a.key}_name`)}</div>
                  <div className="ach-tile-desc">{t(`achievementsScreen.ach_${a.key}_desc`)}</div>
                </div>
                <Icon name="military_tech" filled className="ach-tile-badge" />
              </div>
            ))}
          </>
        )}

        <p className="ach-section-label">{t('achievementsScreen.locked')}</p>
        {locked.map((a, i) => (
          <div
            key={a.code}
            className="ach-tile ach-tile--locked animate__animated animate__fadeIn animate__faster"
            style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          >
            <div className="ach-tile-icon ach-tile-icon--badge ach-tile-icon--locked">{a.icon}</div>
            <div className="ach-tile-text">
              <div className="ach-tile-title">{t(`achievementsScreen.ach_${a.key}_name`)}</div>
              <div className="ach-tile-desc">{t(`achievementsScreen.ach_${a.key}_desc`)}</div>
            </div>
            <Icon name="lock" filled className="ach-tile-lock" />
          </div>
        ))}
      </div>
    </div>
  );
}
