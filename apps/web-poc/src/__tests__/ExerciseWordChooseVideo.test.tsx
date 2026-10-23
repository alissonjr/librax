import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Sign } from '../lib/content';
import type { VlibrasState } from '../lib/vlibras';

// Player VLibras mockado (o mesmo formato de SignDemo.test.tsx)
const mock = vi.hoisted(() => {
  let state: VlibrasState = { status: 'ready', progress: 1, playing: false, speed: 1, error: null };
  const listeners = new Set<() => void>();
  return {
    get state() { return state; },
    set(patch: Partial<VlibrasState>) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    reset() {
      state = { status: 'ready', progress: 1, playing: false, speed: 1, error: null };
      listeners.clear();
    },
    listeners,
    attach: vi.fn(() => vi.fn()),
    play: vi.fn(async (_g: string) => true),
    stop: vi.fn(),
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
  retryVlibras: vi.fn(),
  stopVlibras: mock.stop,
  setVlibrasSpeed: vi.fn(),
}));

import { ExerciseWordChooseVideo, maskedCaption } from '../components/ExerciseWordChooseVideo';

function makeSign(gloss: string, caption: string, avatar = true): Sign {
  return {
    id: `sinal-${gloss}`,
    gloss,
    category: 'familia',
    recognition: 'dynamic',
    params: { CM: '', PA: '', MOV: '', OR: '', ENM: '' },
    video_url: null,
    video_caption: caption,
    avatar: avatar ? { provider: 'vlibras', gloss } : null,
  };
}

const MAE = makeSign('MÃE', 'Dedos tocam o queixo, como quem lembra da mãe.');
const PAI = makeSign('PAI', 'Mão no queixo e depois na testa, o pai.');
const FILHO = makeSign('FILHO', 'Braços embalam, filho no colo.');
const BEBE = makeSign('BEBÊ', 'Braços embalam um bebê.');
const OPTIONS = [PAI, MAE, FILHO, BEBE];

function setup(options = OPTIONS) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  render(<ExerciseWordChooseVideo word="MÃE" sign={MAE} options={options} onAnswer={onAnswer} onNext={onNext} />);
  return { onAnswer, onNext };
}

beforeEach(() => {
  mock.reset();
  vi.clearAllMocks();
});

describe('ExerciseWordChooseVideo', () => {
  it('mostra a palavra e 4 cartões sem a glosa de nenhuma opção', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Qual é o sinal de MÃE/ })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(4);
    items.forEach((item, i) => {
      expect(within(item).getByRole('button', { name: `Escolher a opção ${i + 1}` })).toBeInTheDocument();
      expect(within(item).getByRole('button', { name: `Ver a demonstração da opção ${i + 1}` })).toBeInTheDocument();
    });
    for (const g of ['PAI', 'FILHO', 'BEBÊ']) expect(screen.queryByText(g)).not.toBeInTheDocument();
  });

  it('não toca nada ao abrir: o avatar só carrega quando a pessoa pede uma demonstração', () => {
    setup();
    expect(mock.attach).not.toHaveBeenCalled();
    expect(mock.play).not.toHaveBeenCalled();
  });

  it('toca uma demonstração por vez, sob demanda, e ver não conta como resposta', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Ver a demonstração da opção 1' }));
    expect(mock.play).toHaveBeenLastCalledWith('PAI');
    await userEvent.click(screen.getByRole('button', { name: 'Ver a demonstração da opção 3' }));
    expect(mock.play).toHaveBeenLastCalledWith('FILHO');
    // o avatar é um só: trocar de opção para a demonstração anterior
    expect(mock.stop).toHaveBeenCalled();
    expect(screen.getAllByRole('img', { name: /sinal da pergunta/ })).toHaveLength(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('escolher a certa marca acerto e mostra as glosas', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Escolher a opção 2' }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.getByText('Correto!')).toBeInTheDocument();
    expect(screen.getByText('PAI')).toBeInTheDocument();
  });

  it('escolher a errada mostra qual era a certa e espera o toque para seguir', async () => {
    const { onAnswer, onNext } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Escolher a opção 1' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.getByText(/A resposta certa é a opção 2/)).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('sem avatar nem vídeo, o cartão mostra a descrição com a glosa mascarada', () => {
    setup(OPTIONS.map((s) => ({ ...s, avatar: null })));
    expect(screen.queryByRole('button', { name: /Ver a demonstração/ })).not.toBeInTheDocument();
    expect(screen.getByText('Dedos tocam o queixo, como quem lembra da ___.')).toBeInTheDocument();
    expect(screen.getByText('Mão no queixo e depois na testa, o ___.')).toBeInTheDocument();
    expect(screen.getByText('Braços embalam um ___.')).toBeInTheDocument();
  });

  it('avatar com erro também cai na descrição mascarada', () => {
    mock.set({ status: 'error', error: 'offline' });
    setup();
    expect(screen.queryByRole('button', { name: /Ver a demonstração/ })).not.toBeInTheDocument();
    expect(screen.getByText('Braços embalam, ___ no colo.')).toBeInTheDocument();
  });

  it('maskedCaption esconde a glosa da opção e a palavra do enunciado', () => {
    const other = makeSign('PAI', 'Igual ao de mãe, mas na testa: pai.');
    expect(maskedCaption(other, 'MÃE')).toBe('Igual ao de ___, mas na testa: ___.');
  });
});
