/// <reference types="vite/client" />

/** Variáveis de build (ver .env.example). Todas opcionais: sem elas o app roda só como convidado. */
interface ImportMetaEnv {
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_AUTH_REDIRECT_SIGN_IN?: string;
  readonly VITE_AUTH_REDIRECT_SIGN_OUT?: string;
  /** Só no ambiente local (npm run dev:local): proxy do cognito-idp simulado. */
  readonly VITE_COGNITO_ENDPOINT?: string;
  readonly VITE_API_BASE?: string;
  /** Chave pública VAPID (/librax/vapid/public-key): sem ela, o app não oferece notificações. */
  readonly VITE_VAPID_PUBLIC_KEY?: string;
  /** `true` oferece o lembrete por e-mail (librax:emailRemindersEnabled, SES ligado na infra). */
  readonly VITE_EMAIL_REMINDERS?: string;
  /** `false` esconde o "Continuar com Google" (Google desligado no Cognito, librax:googleEnabled). */
  readonly VITE_GOOGLE_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Versão do build (vite.config.ts, define): data e hora do build em ISO e o commit curto ('' sem git). */
declare const __LX_BUILD_TIME__: string;
declare const __LX_BUILD_COMMIT__: string;
