import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Sign } from '../lib/content';
import type { VlibrasState } from '../lib/vlibras';

// Player VLibras mockado: um store simples que o teste controla
const mock = vi.hoisted(() => {
  let state: VlibrasState = { status: 'idle', progress: 0, playing: false, speed: 1, error: null };
  const listeners = new Set<() => void>();
  return {
    get state() { return state; },
    set(patch: Partial<VlibrasState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset() {
      state = { status: 'idle', progress: 0, playing: false, speed: 1, error: null };
      listeners.clear();
    },
    listeners,
    attach: vi.fn(() => vi.fn()),
    play: vi.fn(async (_g: string) => true),
    retry: vi.fn(),
    stop: vi.fn(),
    setSpeed: vi.fn(),
  };
});

vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => mock.state,
  subscribeVlibras: (l: () => void) => { mock.listeners.add(l); return () => mock.listeners.delete(l); },
  attachVlibras: mock.attach,
  play: mock.play,
  retryVlibras: mock.retry,
  stopVlibras: mock.stop,
  setVlibrasSpeed: mock.setSpeed,
}));

import { SignDemo, chooseDemoMode } from '../components/SignDemo';
import { ExerciseWatchChooseWord } from '../components/ExerciseWatchChooseWord';

function makeSign(over: Partial<Sign> = {}): Sign {
  return {
    id: 'sinal-BANANA',
    gloss: 'BANANA',
    category: 'comida',
    recognition: 'dynamic',
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null,
    video_caption: 'Gesto como se descascasse uma banana.',
    avatar: { provider: 'vlibras', gloss: 'BANANA' },
    ...over,
  };
}

const FALLBACK = <p>descricao em texto</p>;

beforeEach(() => {
  mock.reset();
  mock.attach.mockClear();
  mock.play.mockReset();
  mock.play.mockImplementation(async () => true);
  mock.retry.mockClear();
});

describe('chooseDemoMode', () => {
  it('prefere o vídeo quando existe, mesmo com avatar', () => {
    expect(chooseDemoMode(makeSign({ video_url: '/v/banana.mp4' }))).toBe('video');
  });

  it('usa o avatar quando não há vídeo e a glosa existe', () => {
    expect(chooseDemoMode(makeSign())).toBe('avatar');
  });

  it('cai no texto sem avatar, com glosa nula ou depois de falha', () => {
    expect(chooseDemoMode(makeSign({ avatar: undefined }))).toBe('text');
    expect(chooseDemoMode(makeSign({ avatar: { provider: 'vlibras', gloss: null } }))).toBe('text');
    expect(chooseDemoMode(makeSign(), true)).toBe('text');
  });
});

describe('SignDemo', () => {
  it('mostra o vídeo com controles e não carrega o avatar', () => {
    const { container } = render(<SignDemo sign={makeSign({ video_url: '/v/banana.mp4' })} fallback={FALLBACK} />);
    expect(container.querySelector('video')).toHaveAttribute('src', '/v/banana.mp4');
    expect(screen.getByRole('button', { name: /ver o movimento de novo/i })).toBeInTheDocument();
    expect(mock.attach).not.toHaveBeenCalled();
  });

  it('sem vídeo nem avatar mostra a descrição e não carrega o player', () => {
    render(<SignDemo sign={makeSign({ avatar: undefined })} fallback={FALLBACK} />);
    expect(screen.getByText('descricao em texto')).toBeInTheDocument();
    expect(mock.attach).not.toHaveBeenCalled();
  });

  it('com avatar: encaixa o player, mostra o progresso e toca a glosa quando fica pronto', async () => {
    render(<SignDemo sign={makeSign()} fallback={FALLBACK} />);
    expect(mock.attach).toHaveBeenCalledTimes(1);
    expect(mock.play).not.toHaveBeenCalled();

    act(() => mock.set({ status: 'loading', progress: 0.42 }));
    expect(screen.getByText(/42%/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ver o movimento de novo/i })).toBeDisabled();

    act(() => mock.set({ status: 'ready', progress: 1 }));
    await waitFor(() => expect(mock.play).toHaveBeenCalledWith('BANANA'));
    expect(screen.getByRole('img', { name: /avatar vlibras fazendo o sinal banana/i })).toBeInTheDocument();
    expect(screen.getByText(/LGPL-3.0/)).toBeInTheDocument();
  });

  it('repetir toca de novo e a velocidade alterna para 0,75x', async () => {
    mock.set({ status: 'ready', progress: 1 });
    render(<SignDemo sign={makeSign()} fallback={FALLBACK} />);
    await waitFor(() => expect(mock.play).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: /ver o movimento de novo/i }));
    expect(mock.play).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole('button', { name: /velocidade/i }));
    expect(mock.setSpeed).toHaveBeenCalledWith(0.75);
  });

  it('oculto (Qual é este sinal?): o rótulo não traz a glosa', () => {
    mock.set({ status: 'ready', progress: 1 });
    render(<SignDemo sign={makeSign()} conceal fallback={FALLBACK} />);
    const stage = screen.getByRole('img');
    expect(stage.getAttribute('aria-label')).not.toMatch(/banana/i);
  });

  it('falha do player (servidor fora do ar): cai para a descrição e oferece tentar de novo', async () => {
    render(<SignDemo sign={makeSign()} fallback={FALLBACK} />);
    act(() => mock.set({ status: 'error', error: 'unavailable' }));
    expect(screen.getByText('descricao em texto')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/não deu para mostrar o avatar/i);
    await userEvent.click(screen.getByRole('button', { name: /tentar de novo/i }));
    expect(mock.retry).toHaveBeenCalled();
  });

  it('sem internet: mensagem própria', () => {
    mock.set({ status: 'error', error: 'offline' });
    render(<SignDemo sign={makeSign()} fallback={FALLBACK} />);
    expect(screen.getByRole('status')).toHaveTextContent(/sem internet/i);
  });

  it('animação indisponível para este sinal: cai para a descrição', async () => {
    mock.play.mockImplementation(async () => false);
    mock.set({ status: 'ready', progress: 1 });
    render(<SignDemo sign={makeSign()} fallback={FALLBACK} />);
    await waitFor(() => expect(screen.getByText('descricao em texto')).toBeInTheDocument());
  });
});

describe('ExerciseWatchChooseWord com avatar', () => {
  it('na falha mantém a descrição mascarada até responder', () => {
    mock.set({ status: 'error', error: 'unavailable' });
    render(
      <ExerciseWatchChooseWord
        sign={makeSign()}
        choices={['BANANA', 'MAÇÃ', 'PÃO', 'OVO']}
        onAnswer={() => {}}
        onNext={() => {}}
      />,
    );
    expect(screen.getByText(/descascasse uma ___/i)).toBeInTheDocument();
  });

  it('com o avatar pronto, nada na demonstração entrega a glosa', async () => {
    mock.set({ status: 'ready', progress: 1 });
    const { container } = render(
      <ExerciseWatchChooseWord
        sign={makeSign()}
        choices={['BANANA', 'MAÇÃ', 'PÃO', 'OVO']}
        onAnswer={() => {}}
        onNext={() => {}}
      />,
    );
    await waitFor(() => expect(mock.play).toHaveBeenCalledWith('BANANA'));
    const demo = container.querySelector('.sign-demo')!;
    expect(demo.textContent).not.toMatch(/banana/i);
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toMatch(/banana/i);
  });
});
