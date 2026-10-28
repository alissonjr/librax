import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { Icon } from '../components/Icon';
import { configureAuth, getSession, onAuthEvent, signInWithGoogle } from '../lib/auth';
import { oauthReturn, refreshAccount } from '../lib/account';
import { flushOutbox } from '../lib/sync';

interface Props {
  /** Login concluído (ou nada a concluir): segue para o app. */
  onDone: () => void;
  /** "Tentar de novo" depois de falha: volta para /entrar. */
  onRetry: () => void;
}

/** Tempo máximo esperando o Cognito trocar o código por tokens (rede lenta). */
const CALLBACK_TIMEOUT_MS = 20_000;

/**
 * Google recém-ligado à conta de e-mail com o mesmo endereço (oauthReturn().linked): o primeiro login
 * volta com erro de propósito e o app repete o login pelo Google uma vez só nesta aba, que agora entra
 * na conta ligada. Decidido uma vez por carga da página (o React pode montar a tela duas vezes).
 */
const LINK_RETRY_KEY = 'librax_googleLinkRetry';
let linkRetry: boolean | null = null;
function linkRetryAllowed(): boolean {
  if (linkRetry !== null) return linkRetry;
  try {
    linkRetry = sessionStorage.getItem(LINK_RETRY_KEY) === null;
    sessionStorage.setItem(LINK_RETRY_KEY, '1');
  } catch {
    linkRetry = false;
  }
  return linkRetry;
}
function clearLinkRetry(): void {
  try { sessionStorage.removeItem(LINK_RETRY_KEY); } catch { /* sem armazenamento */ }
}

/** Testes: esquece a decisão desta carga. */
export function __resetLinkRetryForTests(): void {
  linkRetry = null;
}

/**
 * /auth/callback: volta do Google (spec-02 12.2). O Amplify lê o ?code= da URL e troca por
 * tokens com o code_verifier do PKCE; por isso esta rota não redireciona antes de
 * configureAuth() e da sessão estar pronta (fetchAuthSession espera o OAuth em andamento).
 * Depois leva o progresso do convidado para a conta e segue para o app.
 */
export function AuthCallbackScreen({ onDone, onRetry }: Props) {
  const { t } = useT();
  const [failed, setFailed] = useState<false | 'generic' | 'linked'>(() => {
    const ret = oauthReturn();
    if (ret.error === null) return false;
    if (!ret.linked) return 'generic';
    return linkRetryAllowed() ? false : 'linked';
  });
  // As funções das rotas mudam a cada render; o efeito roda uma vez só
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    // Google devolveu erro (pessoa cancelou, conta recusada): não há o que esperar. Conta recém-ligada:
    // repete o login pelo Google uma vez
    if (oauthReturn().error !== null) {
      if (oauthReturn().linked && linkRetryAllowed()) {
        void configureAuth()
          .then(() => signInWithGoogle())
          .catch(() => setFailed('linked'));
      }
      return;
    }
    let alive = true;
    let stop: (() => void) | null = null;
    let timer = 0;

    const succeed = () => {
      if (!alive) return;
      alive = false;
      window.clearTimeout(timer);
      stop?.();
      clearLinkRetry();
      void refreshAccount();
      void flushOutbox().catch(() => {});
      done.current();
    };

    (async () => {
      const enabled = await configureAuth().catch(() => false);
      if (!alive) return;
      // Sem Cognito neste ambiente não há o que concluir
      if (!enabled) {
        alive = false;
        done.current();
        return;
      }
      stop = await onAuthEvent(event => { if (event === 'signedIn') succeed(); }).catch(() => null);
      if (!alive) { stop?.(); return; }
      timer = window.setTimeout(() => {
        if (!alive) return;
        alive = false;
        stop?.();
        setFailed('generic');
      }, CALLBACK_TIMEOUT_MS);
      if (await getSession()) {
        succeed();
        return;
      }
      if (alive && !oauthReturn().hasCode) {
        // Abriu /auth/callback sem voltar do Google (recarga, link velho): segue como convidado
        alive = false;
        window.clearTimeout(timer);
        stop?.();
        done.current();
        return;
      }
      // Com código e ainda sem sessão: confere de novo algumas vezes antes do tempo máximo
      for (let i = 0; i < 3 && alive; i++) {
        await new Promise(r => window.setTimeout(r, 2000));
        if (alive && await getSession()) {
          succeed();
          return;
        }
      }
      if (alive) {
        alive = false;
        window.clearTimeout(timer);
        stop?.();
        setFailed('generic');
      }
    })();

    return () => {
      alive = false;
      window.clearTimeout(timer);
      stop?.();
    };
  }, []);

  if (failed) {
    return (
      <div className="app-loading route-error">
        <Icon name="cloud_off" size="64px" />
        <h1 className="auth-callback-title">{t(failed === 'linked' ? 'account.callbackLinked' : 'account.callbackFailed')}</h1>
        <button className="btn btn-primary route-error-btn" onClick={onRetry}>
          <Icon name="replay" /> {t('routeError.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="app-loading auth-callback" aria-busy="true">
      <Icon name="progress_activity" spin size="48px" />
      <h1 className="auth-callback-title">{t('account.callbackLoading')}</h1>
    </div>
  );
}
