/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_DOMAIN?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_API_BASE?: string;
}

/** Situação do conteúdo gerada pelo services/api (npm run catalog), usada nos dados de exemplo. */
declare module '*/content/contentStatus.js' {
  const report: unknown;
  export default report;
}
