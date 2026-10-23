import { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { getDb } from './lib/db';
import { IdbRepo } from './lib/idbRepo';
import { getUserId, isOnboarded } from './lib/auth';
import { getToday } from './lib/today';
import { newProfile } from '@domain/profile.js';
import { Flags } from './lib/flags';
import { useT } from './i18n';
import { DialogProvider } from './hooks/useDialog';
import { SessionProvider } from './hooks/useSession';
import { routes, ROUTER_FUTURE } from './router';

interface Boot {
  repo: IdbRepo;
  userId: string;
  brokenStreak: number;
}

/**
 * Abre o banco local, garante o perfil e detecta sequência perdida. A navegação fica no
 * roteador (src/router.tsx): cada tela tem URL e o voltar do navegador e do Android funcionam.
 */
async function boot(): Promise<Boot> {
  const db = await getDb();
  const userId = getUserId();
  const repo = new IdbRepo(db, userId);

  const profile = await repo.getProfile(userId);
  if (!profile) {
    await repo.saveProfile({ ...newProfile(userId), achievements: [] });
  }

  if ('storage' in navigator && 'persist' in navigator.storage) {
    navigator.storage.persist().catch(() => {});
  }

  // Detecta streak quebrado para mostrar o StreakBrokenSheet
  let brokenStreak = 0;
  if (isOnboarded()) {
    const profileData = await repo.getProfile(userId) as Record<string, unknown> | null;
    const currentStreak = (profileData?.streak as number) ?? 0;
    const lastKnown = Flags.lastStreakValue();
    const today = getToday();
    const lastShown = Flags.streakBrokenShownDate();
    if (currentStreak === 0 && lastKnown > 0 && lastShown !== today) {
      brokenStreak = lastKnown;
      Flags.setStreakBrokenShownDate(today);
    }
    // Atualiza o valor armazenado da sequencia
    if (currentStreak > 0) Flags.setLastStreakValue(currentStreak);
  }

  return { repo, userId, brokenStreak };
}

export function App() {
  const { t } = useT();
  const [state, setState] = useState<Boot | null>(null);
  const [router] = useState(() => createBrowserRouter(routes, { future: ROUTER_FUTURE }));

  useEffect(() => {
    boot().then(setState);
  }, []);

  if (!state) {
    return (
      <div className="app-loading">
        <p>{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <SessionProvider repo={state.repo} userId={state.userId} brokenStreak={state.brokenStreak}>
      <DialogProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </DialogProvider>
    </SessionProvider>
  );
}
