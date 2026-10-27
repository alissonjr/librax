import { useState, type FormEvent } from 'react';
import { Icon } from '../components/Icon';
import { QrCode } from '../components/QrCode';
import { Chip } from '../components/ui';
import { groupSecret, normalizeCode, type MfaSecret, type MfaSetupApi } from '../lib/mfa';

type Step =
  | { kind: 'intro' }
  | { kind: 'loading' }
  | { kind: 'scan'; secret: MfaSecret; busy: boolean }
  | { kind: 'done' };

/**
 * Primeiro acesso de admin: ligar o aplicativo autenticador da conta (a API do painel exige). Depois de
 * confirmado, o painel confere o acesso de novo (`onDone`) e o login do Cognito passa a pedir o código.
 */
export function MfaSetupScreen({ setup, onDone, onLogout }: { setup: MfaSetupApi; onDone: () => void; onLogout: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'intro' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    setStep({ kind: 'loading' });
    try {
      setStep({ kind: 'scan', secret: await setup.start(), busy: false });
    } catch (err) {
      setError((err as Error).message);
      setStep({ kind: 'intro' });
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    if (step.kind !== 'scan' || step.busy) return;
    if (!normalizeCode(code)) {
      setError('Digite os 6 números que aparecem no aplicativo.');
      return;
    }
    setError(null);
    setStep({ ...step, busy: true });
    try {
      await setup.verify(code);
      setStep({ kind: 'done' });
    } catch (err) {
      setError((err as Error).message);
      setStep({ ...step, busy: false });
    }
  }

  if (step.kind === 'done') {
    return (
      <>
        <Chip tone="ok" icon="check_circle">Autenticador ligado</Chip>
        <h1 className="splash-title">Pronto</h1>
        <p>Daqui em diante, o login do painel pede o código do aplicativo depois da senha. Guarde o celular com cuidado: sem ele, peça ao dono do projeto para refazer a configuração.</p>
        <button type="button" className="btn btn--primary" onClick={onDone}>
          <Icon name="arrow_forward" /> Abrir o painel
        </button>
      </>
    );
  }

  return (
    <>
      <Chip tone="warn" icon="lock">Segundo fator</Chip>
      <h1 className="splash-title">Configure o aplicativo autenticador</h1>
      {step.kind !== 'scan' ? (
        <>
          <p>O painel mostra dados das contas, então pede um código do celular além da senha. Configure uma vez, agora:</p>
          <ol className="mfa-steps">
            <li>Instale um aplicativo autenticador no celular (Google Authenticator, Microsoft Authenticator, 1Password ou outro).</li>
            <li>Leia o QR code que aparece no próximo passo.</li>
            <li>Digite o código de 6 dígitos que o aplicativo mostrar.</li>
          </ol>
          {error && <p className="mfa-error" role="alert">{error}</p>}
          <button type="button" className="btn btn--primary" onClick={() => void start()} disabled={step.kind === 'loading'}>
            {step.kind === 'loading' ? <><span className="spinner" aria-hidden="true" /> Gerando a chave...</> : <><Icon name="shield" /> Começar</>}
          </button>
        </>
      ) : (
        <form className="mfa-form" onSubmit={(e) => void confirm(e)} noValidate>
          <p>No aplicativo, toque em adicionar conta e leia o QR code.</p>
          <div className="mfa-qr">
            <QrCode text={step.secret.uri} label="QR code do aplicativo autenticador" />
          </div>
          <details className="mfa-secret">
            <summary>Não consegue ler? Digite a chave</summary>
            <code aria-label="Chave do autenticador">{groupSecret(step.secret.secret)}</code>
            <span className="mfa-hint">Tipo: baseado em tempo (TOTP), 6 dígitos.</span>
          </details>
          <label className="field">
            <span className="field-label">Código de 6 dígitos</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="123456"
              aria-invalid={error ? true : undefined}
            />
          </label>
          {error && <p className="mfa-error" role="alert">{error}</p>}
          <button type="submit" className="btn btn--primary" disabled={step.busy}>
            {step.busy ? <><span className="spinner" aria-hidden="true" /> Conferindo...</> : <><Icon name="check" /> Confirmar</>}
          </button>
        </form>
      )}
      <button type="button" className="btn btn--ghost" onClick={onLogout}>
        <Icon name="logout" /> Sair
      </button>
    </>
  );
}
