import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Volta do Google com a conta recém-ligada (gatilho PreSignUp, services/api/src/handlers/preSignUp.js):
// o app repete o login pelo Google uma vez; na segunda volta com a mesma marca, explica. E o cadastro
// com senha de e-mail do Google vira uma mensagem própria.

const auth = vi.hoisted(() => ({
  configureAuth: vi.fn(async () => true),
  signInWithGoogle: vi.fn(async () => {}),
  getSession: vi.fn(async () => null),
  onAuthEvent: vi.fn(async () => () => {}),
}));

vi.mock('../lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/auth')>()), ...auth }));

const LINKED = '/auth/callback?error=invalid_request&error_description=PreSignUp+failed+with+error+LIBRAX_CONTA_LIGADA.';

/** A tela lê os parâmetros na carga da página: troca a URL e importa de novo. */
async function loadAt(url: string) {
  window.history.replaceState(null, '', url);
  vi.resetModules();
  return (await import('../screens/AuthCallbackScreen')).AuthCallbackScreen;
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('volta do Google com a conta ligada', () => {
  it('na primeira vez repete o login pelo Google, sem mostrar erro', async () => {
    const Screen = await loadAt(LINKED);
    render(<Screen onDone={vi.fn()} onRetry={vi.fn()} />);
    await waitFor(() => expect(auth.signInWithGoogle).toHaveBeenCalledOnce());
    expect(screen.queryByText(/Não foi possível/)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('librax_googleLinkRetry')).toBe('1');
  });

  it('se voltar de novo com a marca, explica em vez de repetir sem fim', async () => {
    sessionStorage.setItem('librax_googleLinkRetry', '1');
    const Screen = await loadAt(LINKED);
    render(<Screen onDone={vi.fn()} onRetry={vi.fn()} />);
    expect(await screen.findByText(/Ligamos o Google à sua conta/)).toBeInTheDocument();
    expect(auth.signInWithGoogle).not.toHaveBeenCalled();
  });

  it('outro erro do Google segue com a mensagem de sempre', async () => {
    const Screen = await loadAt('/auth/callback?error=access_denied');
    render(<Screen onDone={vi.fn()} onRetry={vi.fn()} />);
    expect(await screen.findByText('Não foi possível entrar com o Google.')).toBeInTheDocument();
    expect(auth.signInWithGoogle).not.toHaveBeenCalled();
  });
});

describe('cadastro com senha de e-mail do Google', () => {
  it('vira a mensagem própria; outra recusa do gatilho segue como erro genérico', async () => {
    const { authErrorCode } = await vi.importActual<typeof import('../lib/auth')>('../lib/auth');
    const { authErrorKey } = await import('../lib/account');
    const err = Object.assign(new Error('PreSignUp failed with error LIBRAX_EMAIL_DO_GOOGLE.'), { name: 'UserLambdaValidationException' });
    expect(authErrorCode(err)).toBe('GOOGLE_ACCOUNT');
    expect(authErrorKey('GOOGLE_ACCOUNT')).toBe('account.errors.googleAccount');
    const outro = Object.assign(new Error('PreSignUp failed with error x.'), { name: 'UserLambdaValidationException' });
    expect(authErrorCode(outro)).toBe('UNKNOWN');
  });
});
