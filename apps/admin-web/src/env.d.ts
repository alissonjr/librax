/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** User Pool (output UserPoolId): dá a região do cognito-idp e o nome do pool no SRP. */
  readonly VITE_COGNITO_USER_POOL_ID?: string;
  /** App client do painel (output AdminClientId). */
  readonly VITE_COGNITO_CLIENT_ID?: string;
  /** Só no ambiente local: proxy do cognito-idp no lugar do endereço da AWS. */
  readonly VITE_COGNITO_ENDPOINT?: string;
  /** Só no ambiente local: origem do app (o "Esqueci a senha" abre o app). Em produção, a mesma do painel. */
  readonly VITE_APP_ORIGIN?: string;
  readonly VITE_API_BASE?: string;
}

/** Situação do conteúdo gerada pelo services/api (npm run catalog), usada nos dados de exemplo. */
declare module '*/content/contentStatus.js' {
  const report: unknown;
  export default report;
}

/** Lado do servidor do SRP do ambiente local (services/api/local/srp.mjs), usado nos testes do login. */
declare module '*/local/srp.mjs' {
  export function makeVerifier(o: { userPoolId: string; userId: string; password: string }): { salt: string; verifier: string };
  export function startChallenge(o: { verifier: string; A: string }): { B: string; state: { A: string; b: string; B: string } };
  export function verifyClaim(o: {
    userPoolId: string;
    userId: string;
    verifier: string;
    state: { A: string; b: string; B: string };
    secretBlock: string;
    timestamp: string;
    claimSignature: string;
  }): boolean;
  export function newSecretBlock(): string;
  export function nowString(date?: Date): string;
}
