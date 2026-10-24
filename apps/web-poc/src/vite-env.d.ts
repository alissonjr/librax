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
  readonly VITE_VAPID_PUBLIC_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
