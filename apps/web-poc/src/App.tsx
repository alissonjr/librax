import { useState, useEffect } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { getDb } from './lib/db';
import { IdbRepo } from './lib/idbRepo';
import { getUserId } from './lib/auth';
import { startAccount, useAccount } from './lib/account';
import { reportDevice } from './lib/device';
import { renewPushOnOpen } from './lib/reminders';
import { retryAccountRestore } from './lib/accountRestore';
import { setTelemetryContext, startTelemetry } from './lib/telemetry';
import { refreshTelemetryProgress } from './lib/telemetryProgress';
import { evaluateAppOpen, preloadAppOpen } from './lib/appOpen';
import { forgetAccountSocial, syncDisplayName } from './lib/social';
import { setSplashLabel, splashStep } from './lib/splash';
import { newProfile } from '@domain/profile.js';
import { useT } from './i18n';
import { SessionProvider } from './hooks/useSession';
import { routes, ROUTER_FUTURE } from './router';

interface Boot {
  repo: IdbRepo;
  userId: string;
  brokenStreak: number;
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

  // Dados de uso anônimos (lib/telemetry.ts): só mandam; nada volta nem muda o progresso local. O
  // retrato do progresso é lido sem segurar a abertura (o primeiro envio é no fim da lição ou ao sair)
  void refreshTelemetryProgress(repo, userId);
  startTelemetry();

  // AppOpenFlow (spec-02 12.10): a sequência quebrada; o resultado da liga chega do servidor depois
  const { brokenStreak } = await evaluateAppOpen(repo, userId);
  // Tela de abertura: banco local e perfil prontos
  splashStep('storage');

  return { repo, userId, brokenStreak };
}

export function App() {
  const { t, lang } = useT();
  const account = useAccount();
  const [state, setState] = useState<Boot | null>(null);
  const [router] = useState(() => createBrowserRouter(routes, { future: ROUTER_FUTURE }));

  useEffect(() => {
    boot().then(setState);
  }, []);

  // Com conta: avisa o servidor deste aparelho e do idioma (aviso de acesso novo e idioma dos e-mails,
  // lib/device.ts), ao entrar e quando o idioma muda
  useEffect(() => {
    if (account.status === 'signedIn') void reportDevice(lang);
  }, [account.status, lang]);

  // Com conta: o nome escolhido no app vai para o servidor (é o que as ligas mostram). Ao sair, o
  // aparelho esquece o que era da conta (nome enviado, escolha da liga geral, liga guardada)
  useEffect(() => {
    if (account.status === 'signedIn') void syncDisplayName();
    if (account.status === 'guest') {
      forgetAccountSocial();
      void import('./lib/league').then(m => m.forgetLeague());
    }
  }, [account.status]);

  // Com conta e a notificação ligada: renova a inscrição deste navegador e conta a abertura do app
  // (sem lembrete nas 3 horas seguintes; aberto pelo lembrete, conta como interação; lib/reminders.ts)
  useEffect(() => {
    if (account.status === 'signedIn') void renewPushOnOpen();
  }, [account.status]);

  // Com conta: termina a busca do progresso da conta que falhou ao entrar (lib/accountRestore.ts)
  useEffect(() => {
    if (account.status === 'signedIn' && state) void retryAccountRestore(state.repo, state.userId);
  }, [account.status, state]);

  // Dados de uso anônimos: só se há conta (sim ou não, nunca qual) e o idioma do app
  useEffect(() => {
    setTelemetryContext({ hasAccount: account.status === 'signedIn', lang });
  }, [account.status, lang]);

  // A barra da abertura é anunciada no idioma do app (o index.html sai em pt-BR)
  useEffect(() => { setSplashLabel(t('splash.label'), t('brand.betaAria')); }, [t]);

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
    >
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </SessionProvider>
  );
}
