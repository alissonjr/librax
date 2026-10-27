import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const auth = vi.hoisted(() => ({
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  confirmEmailCode: vi.fn(),
  requestPasswordReset: vi.fn(),
  resendSignUpCode: vi.fn(),
  confirmPasswordReset: vi.fn(),
  signInWithGoogle: vi.fn(),
  getSession: vi.fn(async () => null),
}));
vi.mock('../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/auth')>()),
  ...auth,
}));
vi.mock('../lib/sync', () => ({ flushOutbox: vi.fn(async () => ({ sent: 0, dropped: 0, remaining: 0 })) }));

import { AuthScreen, type AuthMode } from '../screens/AuthScreen';
import { __resetAccountForTests } from '../lib/account';

function cognitoEnv() {
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'us-east-1_teste');
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', 'cliente');
  vi.stubEnv('VITE_COGNITO_DOMAIN', 'auth.librax.example');
  __resetAccountForTests({ status: 'guest', email: null });
}

function renderAuth(mode: AuthMode) {
  const props = { onSwitchMode: vi.fn(), onDone: vi.fn(), onBack: vi.fn() };
  render(<AuthScreen mode={mode} {...props} />);
  return props;
}

const cognitoError = (name: string) => Object.assign(new Error(name), { name });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  __resetAccountForTests();
});

describe('sem Cognito neste ambiente', () => {
  it('mostra "Login indisponível neste ambiente" e deixa seguir como convidado', async () => {
    __resetAccountForTests();
    const props = renderAuth('login');
    expect(screen.getByRole('heading', { name: 'Login indisponível neste ambiente' })).toBeInTheDocument();
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar como convidado' }));
    expect(props.onBack).toHaveBeenCalled();
  });
});

describe('entrar (spec-02 12.3)', () => {
  beforeEach(cognitoEnv);

  it('"Entrar" só habilita com e-mail e senha válidos; Apple não aparece', async () => {
    renderAuth('login');
    const submit = screen.getByRole('button', { name: 'Entrar' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    expect(submit).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continuar com Google' })).toBeInTheDocument();
    expect(screen.queryByText(/apple/i)).not.toBeInTheDocument();
  });

  it('enviando: spinner no botão e campos travados; erro: mensagem inline', async () => {
    let fail: (e: unknown) => void = () => {};
    auth.signInWithEmail.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'errada12');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));

    expect(screen.getByLabelText('E-mail')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Enviando...' })).toHaveAttribute('aria-busy', 'true');

    fail(cognitoError('NotAuthorizedException'));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.');
    expect(screen.getByLabelText('E-mail')).toBeEnabled();
  });

  it('login certo conclui e segue', async () => {
    auth.signInWithEmail.mockResolvedValue({ done: true, nextStep: 'DONE' });
    const props = renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(auth.signInWithEmail).toHaveBeenCalledWith('ana@librax.example', 'segredo123');
  });

  it('Google sai por redirect', async () => {
    auth.signInWithGoogle.mockReturnValue(new Promise(() => {}));
    renderAuth('login');
    await userEvent.click(screen.getByRole('button', { name: 'Continuar com Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Abrindo o Google...' })).toBeDisabled();
  });

  it('não confirmado: pede o código', async () => {
    auth.signInWithEmail.mockRejectedValue(cognitoError('UserNotConfirmedException'));
    renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('heading', { name: 'Confirme seu e-mail' })).toBeInTheDocument();
  });
});

describe('esqueci a senha', () => {
  beforeEach(cognitoEnv);

  async function openForgot(email = 'ana@librax.example') {
    renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), email);
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci a senha' }));
    expect(screen.getByRole('heading', { name: 'Recuperar a senha' })).toBeInTheDocument();
  }

  async function askCode() {
    await userEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    return screen.findByRole('heading', { name: 'Crie uma senha nova' });
  }

  it('só aparece em Entrar; leva o e-mail digitado e orienta quem entrou com o Google', async () => {
    renderAuth('register');
    expect(screen.queryByRole('button', { name: 'Esqueci a senha' })).not.toBeInTheDocument();
    cleanup();

    await openForgot();
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@librax.example');
    expect(screen.getByRole('note')).toHaveTextContent('Criou a conta com o Google? Ela não tem senha');
    auth.signInWithGoogle.mockReturnValue(new Promise(() => {}));
    await userEvent.click(screen.getByRole('button', { name: 'Continuar com Google' }));
    expect(auth.signInWithGoogle).toHaveBeenCalled();
  });

  it('a resposta não conta se o e-mail tem conta', async () => {
    auth.requestPasswordReset.mockResolvedValue(undefined);
    await openForgot('ninguem@librax.example');
    await askCode();
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('ninguem@librax.example', 'pt-BR');
    expect(screen.getByText(/Se houver uma conta com senha para ninguem@librax.example/)).toBeInTheDocument();
  });

  it('código e senha nova: troca a senha e entra com ela', async () => {
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.confirmPasswordReset.mockResolvedValue(undefined);
    auth.signInWithEmail.mockResolvedValue({ done: true, nextStep: 'DONE' });
    renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-velha');
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci a senha' }));
    await askCode();

    // a senha velha digitada não vira a nova; a nova segue a regra do cadastro
    const password = screen.getByLabelText('Senha nova');
    expect(password).toHaveValue('');
    await userEvent.type(screen.getByLabelText('Código de 6 números'), '123456');
    await userEvent.type(password, '1234567');
    const save = screen.getByRole('button', { name: 'Salvar senha nova' });
    expect(save).toBeDisabled();
    await userEvent.type(password, '8');
    await userEvent.click(save);

    await waitFor(() => expect(auth.signInWithEmail).toHaveBeenCalledWith('ana@librax.example', '12345678'));
    expect(auth.confirmPasswordReset).toHaveBeenCalledWith('ana@librax.example', '123456', '12345678');
  });

  it('se o login depois da troca falhar, volta para Entrar com o e-mail e o aviso de sucesso', async () => {
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.confirmPasswordReset.mockResolvedValue(undefined);
    auth.signInWithEmail.mockRejectedValue(cognitoError('NetworkError'));
    await openForgot();
    await askCode();
    await userEvent.type(screen.getByLabelText('Código de 6 números'), '123456');
    await userEvent.type(screen.getByLabelText('Senha nova'), 'senha-nova-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão');
    expect(screen.getByRole('status')).toHaveTextContent('Senha alterada. Agora é só entrar com a senha nova.');
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@librax.example');
    expect(screen.getByLabelText('Senha')).toHaveValue('senha-nova-1');
  });

  it('código errado ou vencido: mensagem com a saída de pedir outro; reenviar avisa', async () => {
    auth.requestPasswordReset.mockResolvedValue(undefined);
    auth.confirmPasswordReset.mockRejectedValueOnce(cognitoError('CodeMismatchException'));
    await openForgot();
    await askCode();
    await userEvent.type(screen.getByLabelText('Código de 6 números'), '000000');
    await userEvent.type(screen.getByLabelText('Senha nova'), 'senha-nova-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorreto ou vencido. Confira o e-mail ou peça outro código.');

    // conta inexistente responde como código errado, nunca como "e-mail sem conta"
    auth.confirmPasswordReset.mockRejectedValueOnce(cognitoError('UserNotFoundException'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    await waitFor(() => expect(auth.confirmPasswordReset).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Código incorreto ou vencido');

    await userEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Pedimos outro código');
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('muitas tentativas e senha fraca têm mensagem própria', async () => {
    auth.requestPasswordReset.mockResolvedValueOnce(undefined);
    await openForgot();
    await askCode();

    auth.confirmPasswordReset.mockRejectedValueOnce(cognitoError('InvalidPasswordException'));
    await userEvent.type(screen.getByLabelText('Código de 6 números'), '123456');
    await userEvent.type(screen.getByLabelText('Senha nova'), 'senha-nova-1');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Senha muito curta. Use pelo menos 8 caracteres.');

    auth.confirmPasswordReset.mockRejectedValueOnce(cognitoError('LimitExceededException'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar senha nova' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas seguidas'));

    auth.requestPasswordReset.mockRejectedValueOnce(cognitoError('LimitExceededException'));
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    await waitFor(() => expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas seguidas');
  });

  it('"Usar outro e-mail" volta ao pedido do código e "Voltar para entrar" ao login', async () => {
    auth.requestPasswordReset.mockResolvedValue(undefined);
    await openForgot();
    await askCode();
    await userEvent.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    expect(screen.getByRole('heading', { name: 'Recuperar a senha' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Voltar para entrar' }));
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@librax.example');
  });
});

describe('criar conta (spec-02 12.3)', () => {
  beforeEach(cognitoEnv);

  it('senha curta não habilita; e-mail em uso mostra a mensagem', async () => {
    auth.signUpWithEmail.mockRejectedValue(cognitoError('UsernameExistsException'));
    renderAuth('register');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), '1234567');
    const submit = screen.getByRole('button', { name: 'Criar conta' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('Pelo menos 8 caracteres.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Senha'), '8');
    await userEvent.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail já em uso.');
  });

  it('cadastro pede o código do e-mail, confirma e entra', async () => {
    auth.signUpWithEmail.mockResolvedValue({ needsConfirmation: true });
    auth.confirmEmailCode.mockResolvedValue(true);
    auth.signInWithEmail.mockResolvedValue({ done: true, nextStep: 'DONE' });
    const props = renderAuth('register');
    await userEvent.type(screen.getByLabelText('Nome'), 'Ana');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));

    expect(await screen.findByText(/Enviamos um código para ana@librax.example/)).toBeInTheDocument();
    expect(auth.signUpWithEmail).toHaveBeenCalledWith('ana@librax.example', 'segredo123', 'Ana', 'pt-BR');

    // Código errado primeiro
    auth.confirmEmailCode.mockRejectedValueOnce(cognitoError('CodeMismatchException'));
    const code = screen.getByLabelText('Código de 6 números');
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Código incorreto ou vencido.');

    await userEvent.clear(code);
    await userEvent.type(code, '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
  });

  it('no código do cadastro, "Reenviar código" pede outro no idioma da tela', async () => {
    auth.signUpWithEmail.mockResolvedValue({ needsConfirmation: true });
    auth.resendSignUpCode.mockResolvedValue(undefined);
    renderAuth('register');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await screen.findByText(/Enviamos um código para ana@librax.example/);

    await userEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Mandamos outro código. Use o mais recente.');
    expect(auth.resendSignUpCode).toHaveBeenCalledWith('ana@librax.example', 'pt-BR');

    auth.resendSignUpCode.mockRejectedValueOnce(cognitoError('LimitExceededException'));
    await userEvent.click(screen.getByRole('button', { name: 'Reenviar código' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('o link troca para Entrar', async () => {
    const props = renderAuth('register');
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(props.onSwitchMode).toHaveBeenCalledWith('login');
  });

  it('avisa que criar a conta aceita os Termos e a Política, com os dois links', () => {
    renderAuth('register');
    const consent = screen.getByText(/Ao criar a conta, você concorda com os/);
    expect(consent).toHaveTextContent('Ao criar a conta, você concorda com os Termos de Uso e a Política de Privacidade.');
    expect(within(consent).getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(within(consent).getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
  });
});

describe('Google desligado na stack (VITE_GOOGLE_ENABLED=false)', () => {
  beforeEach(() => {
    cognitoEnv();
    vi.stubEnv('VITE_GOOGLE_ENABLED', 'false');
  });

  it('Entrar e Criar conta sem o botão do Google nem o "ou"', () => {
    for (const mode of ['login', 'register'] as const) {
      renderAuth(mode);
      expect(screen.queryByRole('button', { name: 'Continuar com Google' })).not.toBeInTheDocument();
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
      expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
      cleanup();
    }
  });

  it('esqueci a senha sem a orientação de quem entrou com o Google', async () => {
    renderAuth('login');
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@librax.example');
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci a senha' }));
    expect(screen.getByRole('heading', { name: 'Recuperar a senha' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar com Google' })).not.toBeInTheDocument();
  });
});

describe('Termos e Política no Entrar', () => {
  beforeEach(cognitoEnv);

  it('o Google pode criar a conta na primeira entrada: a frase também aparece ao entrar', () => {
    renderAuth('login');
    const consent = screen.getByText(/Ao continuar, você concorda com os/);
    expect(within(consent).getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(within(consent).getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
  });
});
