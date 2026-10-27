import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginScreen } from '../screens/LoginScreen';
import { AuthError, type AdminAuth, type Challenge, type SignInResult } from '../lib/auth';

// Tela de entrar do painel: e-mail e senha, código do autenticador e senha nova, com os erros em
// português. O login de verdade (SRP no Cognito) é testado em auth.test.ts; aqui, um falso.

const TOTP: Challenge = { kind: 'totp', session: 'sessao', username: 'sub-ana' };
const NEW_PASSWORD: Challenge = { kind: 'newPassword', session: 'sessao', username: 'sub-ana' };

function fakeAuth(over: Partial<AdminAuth> = {}): AdminAuth {
  return {
    hasSession: () => false,
    signIn: vi.fn(async () => ({ kind: 'done' as const })),
    confirmTotp: vi.fn(async () => ({ kind: 'done' as const })),
    completeNewPassword: vi.fn(async () => ({ kind: 'done' as const })),
    signOut: vi.fn(async () => {}),
    clear: vi.fn(),
    ...over,
  };
}

function renderLogin(auth: AdminAuth, resetUrl = '/entrar') {
  const onSignedIn = vi.fn();
  render(<LoginScreen auth={auth} onSignedIn={onSignedIn} resetUrl={resetUrl} />);
  return onSignedIn;
}

async function typeCredentials(email = 'ana@exemplo.com', password = 'senha-certa-123') {
  await userEvent.type(screen.getByLabelText('E-mail'), email);
  await userEvent.type(screen.getByLabelText('Senha'), password);
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('e-mail e senha', () => {
  it('campos com autocomplete de login, botão só com e-mail válido e senha, sem cadastro', async () => {
    renderLogin(fakeAuth());
    const email = screen.getByLabelText('E-mail');
    const password = screen.getByLabelText('Senha');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    const submit = screen.getByRole('button', { name: 'Entrar' });
    expect(submit).toBeDisabled();
    await userEvent.type(email, 'ana@');
    await userEvent.type(password, 'x');
    expect(submit).toBeDisabled();
    await userEvent.type(email, 'exemplo.com');
    expect(submit).toBeEnabled();
    expect(screen.queryByText(/criar conta|cadastr/i)).not.toBeInTheDocument();
  });

  it('mostrar e esconder a senha', async () => {
    renderLogin(fakeAuth());
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar senha' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'text');
    await userEvent.click(screen.getByRole('button', { name: 'Esconder senha' }));
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password');
  });

  it('"Esqueci a senha" abre a troca de senha do app em outra aba', () => {
    renderLogin(fakeAuth(), 'https://app.librax.example/entrar');
    const link = screen.getByRole('link', { name: /Esqueci a senha/ });
    expect(link).toHaveAttribute('href', 'https://app.librax.example/entrar');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  it('conta sem autenticador: entra direto', async () => {
    const auth = fakeAuth();
    const onSignedIn = renderLogin(auth);
    await typeCredentials(' ana@exemplo.com ');
    expect(auth.signIn).toHaveBeenCalledWith('ana@exemplo.com', 'senha-certa-123');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it.each([
    ['INVALID_CREDENTIALS', 'E-mail ou senha incorretos.'],
    ['TOO_MANY_ATTEMPTS', 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'],
    ['NETWORK', 'Sem conexão com o login. Confira a internet e tente de novo.'],
  ] as const)('erro %s: mensagem amigável e o formulário continua', async (code, message) => {
    const auth = fakeAuth({ signIn: vi.fn(async () => { throw new AuthError(code); }) });
    const onSignedIn = renderLogin(auth);
    await typeCredentials();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.getByLabelText('Senha')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('erro inesperado (fora do AuthError): mensagem genérica, sem detalhe técnico', async () => {
    renderLogin(fakeAuth({ signIn: vi.fn(async () => { throw new Error('TypeError: x is undefined'); }) }));
    await typeCredentials();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível entrar agora');
    expect(screen.queryByText(/TypeError/)).not.toBeInTheDocument();
  });

  it('enquanto entra: botão ocupado e campos travados', async () => {
    let finish: (v: SignInResult) => void = () => {};
    renderLogin(fakeAuth({ signIn: vi.fn(() => new Promise<SignInResult>((r) => { finish = r; })) }));
    await typeCredentials();
    expect(screen.getByRole('button', { name: /Entrando/ })).toBeDisabled();
    expect(screen.getByLabelText('E-mail')).toBeDisabled();
    await act(async () => finish({ kind: 'done' }));
  });
});

describe('código do autenticador', () => {
  it('campo numérico com one-time-code; código errado limpa e deixa tentar de novo', async () => {
    const confirmTotp = vi.fn()
      .mockRejectedValueOnce(new AuthError('BAD_CODE'))
      .mockResolvedValueOnce({ kind: 'done' });
    const auth = fakeAuth({ signIn: vi.fn(async () => TOTP), confirmTotp });
    const onSignedIn = renderLogin(auth);
    await typeCredentials();

    expect(await screen.findByRole('heading', { name: 'Código do autenticador' })).toBeInTheDocument();
    const input = screen.getByLabelText('Código de 6 dígitos');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveFocus();

    // só números, no máximo 6
    await userEvent.type(input, '12a34 5678');
    expect(input).toHaveValue('123456');

    await userEvent.clear(input);
    await userEvent.type(input, '000000');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O código não confere');
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(confirmTotp).toHaveBeenCalledWith(TOTP, '000000');

    await userEvent.type(input, '123456');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(confirmTotp).toHaveBeenLastCalledWith(TOTP, '123456');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('código incompleto: avisa sem chamar o Cognito', async () => {
    const auth = fakeAuth({ signIn: vi.fn(async () => TOTP) });
    renderLogin(auth);
    await typeCredentials();
    await userEvent.type(await screen.findByLabelText('Código de 6 dígitos'), '123');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Digite os 6 números');
    expect(auth.confirmTotp).not.toHaveBeenCalled();
  });

  it('tempo do código acabou: volta para a senha com o e-mail preenchido e o aviso', async () => {
    const auth = fakeAuth({
      signIn: vi.fn(async () => TOTP),
      confirmTotp: vi.fn(async () => { throw new AuthError('SESSION_EXPIRED'); }),
    });
    renderLogin(auth);
    await typeCredentials();
    await userEvent.type(await screen.findByLabelText('Código de 6 dígitos'), '123456');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(await screen.findByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('O tempo para concluir o login acabou. Entre com a senha de novo.');
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@exemplo.com');
    expect(screen.getByLabelText('Senha')).toHaveValue('');
  });

  it('voltar: troca de conta sem erro antigo', async () => {
    renderLogin(fakeAuth({ signIn: vi.fn(async () => TOTP) }));
    await typeCredentials();
    await userEvent.click(await screen.findByRole('button', { name: /Voltar/ }));
    expect(screen.getByRole('heading', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('senha nova (conta com senha temporária)', () => {
  it('pede a senha nova com o mínimo da política e segue para o código', async () => {
    const auth = fakeAuth({
      signIn: vi.fn(async () => NEW_PASSWORD),
      completeNewPassword: vi.fn(async () => TOTP),
    });
    renderLogin(auth);
    await typeCredentials();
    expect(await screen.findByRole('heading', { name: 'Crie uma senha nova' })).toBeInTheDocument();
    const input = screen.getByLabelText('Senha nova');
    expect(input).toHaveAttribute('autocomplete', 'new-password');
    const save = screen.getByRole('button', { name: /Salvar e entrar/ });
    await userEvent.type(input, 'curta');
    expect(save).toBeDisabled();
    await userEvent.type(input, '-mais-longa');
    await userEvent.click(save);
    expect(auth.completeNewPassword).toHaveBeenCalledWith(NEW_PASSWORD, 'curta-mais-longa');
    expect(await screen.findByRole('heading', { name: 'Código do autenticador' })).toBeInTheDocument();
  });

  it('senha recusada pela política: mensagem e continua na mesma tela', async () => {
    renderLogin(fakeAuth({
      signIn: vi.fn(async () => NEW_PASSWORD),
      completeNewPassword: vi.fn(async () => { throw new AuthError('WEAK_PASSWORD'); }),
    }));
    await typeCredentials();
    await userEvent.type(await screen.findByLabelText('Senha nova'), '12345678');
    await userEvent.click(screen.getByRole('button', { name: /Salvar e entrar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha fraca');
    expect(screen.getByRole('heading', { name: 'Crie uma senha nova' })).toBeInTheDocument();
  });
});
