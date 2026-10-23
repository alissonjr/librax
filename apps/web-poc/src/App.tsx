import { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { getDb } from './lib/db';
import { IdbRepo } from './lib/idbRepo';
import { getUserId } from './lib/auth';
import { startAccount } from './lib/account';
import { evaluateAppOpen, preloadAppOpen } from './lib/appOpen';
import type { LeagueResult } from './lib/leagueLocal';
import { newProfile } from '@domain/profile.js';
import { useT } from './i18n';
import { SessionProvider } from './hooks/useSession';
import { routes, ROUTER_FUTURE } from './router';

interface Boot {
  repo: IdbRepo;
  userId: string;
  brokenStreak: number;
  leagueResult: LeagueResult | null;
}

/**
 * Abre o banco local, garante o perfil, liga conta e sincronização e avalia o AppOpenFlow. A navegação fica no
 * roteador (src/router.tsx): cada tela tem URL e o voltar do navegador e do Android funcionam.
 */
async function boot(): Promise<Boot> {
  preloadAppOpen();
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

  // Conta e fila offline: configureAuth() (conclui a volta do Google em /auth/callback antes de
  // qualquer redirecionamento) e startSync(). Sem as VITE_COGNITO_*, segue só como convidado.
  startAccount();

  // AppOpenFlow (spec-02 12.10): resultado da liga e sequência quebrada, nessa ordem
  const { leagueResult, brokenStreak } = await evaluateAppOpen(repo, userId);

  return { repo, userId, brokenStreak, leagueResult };
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
    <SessionProvider
      repo={state.repo}
      userId={state.userId}
      brokenStreak={state.brokenStreak}
      leagueResult={state.leagueResult}
    >
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>
  );
}
