import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { I18nProvider } from '../i18n';
import { resetHandLandmarkerForTests } from '../recognition/landmarker';

// O link "Entrar" só aparece com o login configurado neste ambiente
vi.mock('../lib/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/account')>()),
  authAvailable: () => true,
}));

// MediaPipe fica fora do teste: o modelo da mão é um carregamento que o teste controla
const model = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  HandLandmarker: { createFromOptions: model.create },
}));

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

/** Perfil local de mentira (o pedaço do IdbRepo que a meta usa). */
function fakeRepo(initial: Record<string, unknown> | null) {
  const state = { stored: initial };
  return {
    state,
    getProfile: vi.fn(async () => state.stored),
    saveProfile: vi.fn(async (p: object) => { state.stored = p as Record<string, unknown>; }),
  };
}

const PROFILE = { userId: 'usr-1', xpTotal: 120, streak: 3, dailyGoalXp: 20, achievements: ['first_lesson'] };

function renderOnboarding({
  onDone = vi.fn(), onLogin = vi.fn(), repo = fakeRepo({ ...PROFILE }),
}: { onDone?: ReturnType<typeof vi.fn>; onLogin?: ReturnType<typeof vi.fn>; repo?: ReturnType<typeof fakeRepo> } = {}) {
  render(
    <I18nProvider>
      <OnboardingScreen repo={repo} userId="usr-1" onDone={onDone} onLogin={onLogin} />
    </I18nProvider>,
  );
  return { onDone, onLogin, repo };
}

const click = (name: RegExp) => userEvent.click(screen.getByRole('button', { name }));

/** Idioma (já marcado) e nome. */
async function passLangAndName(name = 'Joao') {
  await click(/continuar/i);
  await userEvent.type(screen.getByPlaceholderText(/como posso/i), name);
  await click(/começar agora/i);
}

/** Do idioma até o passo da câmera. */
async function goToCamera() {
  await passLangAndName();
  await click(/continuar/i);
  expect(screen.getByText(/reconhecimento de gestos/i)).toBeInTheDocument();
}

async function completeOnboarding(name = 'Joao') {
  await passLangAndName(name);
  // Meta (com o som)
  await click(/continuar/i);
  // Câmera
  await click(/agora não/i);
  // Convite do teste de nivelamento (recusado)
  await click(/começar do início/i);
}

let getUserMedia: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('librax_lang', 'pt-BR');
  resetHandLandmarkerForTests();
  model.create.mockReset();
  model.create.mockImplementation(async () => ({ close: vi.fn(), detectForVideo: vi.fn() }));
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  play.mockRestore();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OnboardingScreen: idioma', () => {
  it('o primeiro passo é o idioma, com o do aparelho já marcado e o Entrar à mão', async () => {
    localStorage.clear();
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['es-ES']);
    const { onLogin } = renderOnboarding();

    expect(screen.getByRole('heading', { name: /en qué idioma/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /español/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /português/i })).toHaveAttribute('aria-pressed', 'false');
    // Sem barra de idioma em cima: os três idiomas aparecem uma vez só
    expect(screen.getAllByRole('button', { name: /english/i })).toHaveLength(1);

    await click(/ya tengo cuenta/i);
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('tocar em outro idioma troca o texto na hora, e um Continuar segue para o nome', async () => {
    renderOnboarding();
    expect(screen.getByRole('heading', { name: /em qual idioma/i })).toBeInTheDocument();

    await click(/english/i);
    expect(screen.getByRole('heading', { name: /which language/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /english/i })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('librax_lang')).toBe('en');

    await click(/continue/i);
    expect(screen.getByPlaceholderText(/what should i call you/i)).toBeInTheDocument();
    // Nos outros passos não há seletor de idioma
    expect(screen.queryByRole('button', { name: /português/i })).toBeNull();
  });

  it('Continuar sem tocar em nada grava o idioma detectado', async () => {
    localStorage.clear();
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
    renderOnboarding();
    await click(/continue/i);
    expect(localStorage.getItem('librax_lang')).toBe('en');
  });
});

describe('OnboardingScreen: passos', () => {
  it('nome no segundo passo, com os Termos e a Política, e sem a pergunta do motivo depois', async () => {
    renderOnboarding();
    await click(/continuar/i);
    expect(screen.getByPlaceholderText(/como posso/i)).toBeInTheDocument();
    expect(screen.getByText(/Ao começar, você concorda com os/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');

    await userEvent.type(screen.getByPlaceholderText(/como posso/i), 'Ana');
    await click(/começar agora/i);
    expect(screen.queryByText(/por que você quer aprender/i)).toBeNull();
    expect(screen.getByText(/quanto tempo por dia/i)).toBeInTheDocument();
    // O som é perguntado junto com a meta
    expect(screen.getByText(/sons do app/i)).toBeInTheDocument();
  });

  it('chama onDone ao concluir os passos e grava o nome', async () => {
    const { onDone } = renderOnboarding();
    await completeOnboarding('Maria');
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(localStorage.getItem('librax_displayName')).toBe('Maria');
  });

  it('o convite do teste de nivelamento é uma escolha de mesmo peso, e só ao escolher o onboarding termina', async () => {
    const { onDone } = renderOnboarding();
    await passLangAndName('Bia');
    await click(/continuar/i);
    await click(/agora não/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
    expect(localStorage.getItem('librax_displayName')).toBeNull();
    const fromStart = screen.getByRole('button', { name: /começar do início/i });
    const test = screen.getByRole('button', { name: /já sei o alfabeto\? fazer um teste rápido/i });
    expect(fromStart.className).toBe(test.className);
    await userEvent.click(test);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('placement'));
    expect(localStorage.getItem('librax_displayName')).toBe('Bia');
  });
});

describe('OnboardingScreen: meta diária', () => {
  it('grava a meta escolhida no perfil sem apagar o resto, antes de sair', async () => {
    const repo = fakeRepo({ ...PROFILE });
    let goalWhenDone: unknown;
    const onDone = vi.fn(() => { goalWhenDone = repo.state.stored?.dailyGoalXp; });
    renderOnboarding({ repo, onDone });

    await passLangAndName();
    await click(/10 XP por dia/i);
    expect(screen.getByRole('button', { name: /10 XP por dia/i })).toHaveAttribute('aria-pressed', 'true');
    await click(/continuar/i);
    await click(/agora não/i);
    await click(/começar do início/i);

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(goalWhenDone).toBe(10);
    expect(repo.state.stored).toEqual({ ...PROFILE, dailyGoalXp: 10 });
  });

  it('sem escolher, grava a recomendada (20); sem perfil ainda, parte do perfil padrão', async () => {
    const repo = fakeRepo(null);
    renderOnboarding({ repo });
    await completeOnboarding();
    await waitFor(() => expect(repo.saveProfile).toHaveBeenCalledOnce());
    expect(repo.state.stored).toMatchObject({ userId: 'usr-1', dailyGoalXp: 20, xpTotal: 0, achievements: [] });
  });

  it('falha ao gravar a meta não prende a pessoa nas boas-vindas', async () => {
    const repo = fakeRepo({ ...PROFILE });
    repo.saveProfile.mockRejectedValue(new Error('IndexedDB fora'));
    const { onDone } = renderOnboarding({ repo });
    await completeOnboarding();
    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
  });
});

describe('OnboardingScreen: câmera', () => {
  it('"Agora não" segue sem pedir a câmera', async () => {
    renderOnboarding();
    await goToCamera();
    await click(/agora não/i);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });

  it('"Usar câmera" pede a permissão na hora, mostra a prévia enquanto o modelo carrega e desliga ao sair', async () => {
    const loading = deferred<unknown>();
    model.create.mockReturnValue(loading.promise);
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    renderOnboarding();
    await goToCamera();

    await click(/usar câmera/i);
    // A permissão não espera o modelo da mão
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(await screen.findByText(/preparando a leitura da mão/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/feed da câmera/i)).toBeInTheDocument();
    // A privacidade continua dita
    expect(screen.getByText(/nunca sai do seu dispositivo/i)).toBeInTheDocument();

    await act(async () => { loading.resolve({ close: vi.fn(), detectForVideo: vi.fn() }); });
    expect(await screen.findByText(/mostre a mão para a câmera/i)).toBeInTheDocument();

    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
    expect(track.stop).toHaveBeenCalled();
  });

  it('o Continuar está disponível enquanto a pessoa ainda decide a permissão', async () => {
    getUserMedia.mockReturnValue(new Promise(() => {}));
    renderOnboarding();
    await goToCamera();
    await click(/usar câmera/i);
    expect(screen.getByText(/permita o acesso à câmera/i)).toBeInTheDocument();
    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });

  it('modelo que não carrega: a prévia continua e a pessoa segue', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    model.create.mockRejectedValue(new Error('sem rede'));
    getUserMedia.mockResolvedValue(fakeStream().stream);
    renderOnboarding();
    await goToCamera();
    await click(/usar câmera/i);
    expect(await screen.findByText(/não carregou agora/i)).toBeInTheDocument();
    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });

  it('permissão negada: mensagem tranquila, tentar de novo e seguir sem câmera', async () => {
    getUserMedia.mockRejectedValue(new DOMException('negado', 'NotAllowedError'));
    renderOnboarding();
    await goToCamera();
    await click(/usar câmera/i);
    expect(await screen.findByText(/a câmera ficou bloqueada/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });

  it('aparelho sem câmera: avisa e deixa seguir', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserMedia.mockRejectedValue(new DOMException('nenhuma', 'NotFoundError'));
    renderOnboarding();
    await goToCamera();
    await click(/usar câmera/i);
    expect(await screen.findByText(/não encontramos uma câmera/i)).toBeInTheDocument();
    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });

  it('navegador sem acesso a câmera: não tenta pedir e deixa seguir', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderOnboarding();
    await goToCamera();
    await click(/usar câmera/i);
    expect(screen.getByText(/não encontramos uma câmera/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tentar novamente/i })).toBeNull();
    expect(model.create).not.toHaveBeenCalled();
    await click(/continuar/i);
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
  });
});
