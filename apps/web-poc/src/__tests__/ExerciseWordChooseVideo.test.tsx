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
  it('mostra a palavra e 4 cartões (rádios) sem a glosa de nenhuma opção', () => {
    setup();
    expect(screen.getByRole('heading', { name: /Qual é o sinal de MÃE/ })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: /Qual é o sinal de MÃE/ });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);
    radios.forEach((r, i) => {
      expect(r).toHaveAccessibleName(new RegExp(`Opção ${i + 1}`));
      expect(r).toHaveAttribute('aria-checked', 'false');
    });
    // Sem botões "Ver" separados: o toque no cartão já mostra a demonstração
    expect(screen.queryByRole('button', { name: /Ver a demonstração/ })).not.toBeInTheDocument();
    for (const g of ['PAI', 'FILHO', 'BEBÊ']) expect(screen.queryByText(g)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar' })).toBeDisabled();
  });

  it('não toca nada ao abrir: o avatar só carrega quando a pessoa toca numa opção', () => {
    setup();
    expect(mock.attach).not.toHaveBeenCalled();
    expect(mock.play).not.toHaveBeenCalled();
  });

  it('tocar no cartão seleciona e toca a demonstração, sem corrigir', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    expect(mock.play).toHaveBeenLastCalledWith('PAI');
    expect(screen.getByRole('radio', { name: /Opção 1/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Tocando a opção 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verificar' })).toBeEnabled();
    expect(onAnswer).not.toHaveBeenCalled();
    expect(screen.queryByText('PAI')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('trocar a seleção acompanha o último toque e toca uma demonstração por vez', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Opção 3/ }));
    expect(mock.play).toHaveBeenLastCalledWith('FILHO');
    // o avatar é um só: trocar de opção para a demonstração anterior
    expect(mock.stop).toHaveBeenCalled();
    expect(screen.getAllByRole('img', { name: /sinal da pergunta/ })).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Opção 1/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /Opção 3/ })).toHaveAttribute('aria-checked', 'true');
    // de volta à primeira
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    expect(mock.play).toHaveBeenLastCalledWith('PAI');
    expect(screen.getByRole('radio', { name: /Opção 1/ })).toHaveAttribute('aria-checked', 'true');
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('setas do teclado movem a seleção entre os cartões', async () => {
    setup();
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: /Opção 2/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Opção 2/ })).toHaveFocus();
  });

  it('Verificar com a certa marca acerto e mostra as glosas', async () => {
    const { onAnswer } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Opção 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.getByText('Correto!')).toBeInTheDocument();
    expect(screen.getByText('PAI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
  });

  it('Verificar com a errada mostra qual era a certa e espera o toque para seguir', async () => {
    const { onAnswer, onNext } = setup();
    await userEvent.click(screen.getByRole('radio', { name: /Opção 1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    expect(screen.getByText(/A resposta certa é a opção 2/)).toBeInTheDocument();
    // depois de verificar, tocar em outro cartão não muda nada
    await userEvent.click(screen.getByRole('radio', { name: /FILHO/ }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('sem avatar nem vídeo, o cartão mostra a descrição com a glosa mascarada', () => {
    setup(OPTIONS.map((s) => ({ ...s, avatar: null })));
    expect(screen.getByText('Dedos tocam o queixo, como quem lembra da ___.')).toBeInTheDocument();
    expect(screen.getByText('Mão no queixo e depois na testa, o ___.')).toBeInTheDocument();
    expect(screen.getByText('Braços embalam um ___.')).toBeInTheDocument();
  });

  it('avatar com erro também cai na descrição mascarada', () => {
    mock.set({ status: 'error', error: 'offline' });
    setup();
    expect(screen.getByText('Braços embalam, ___ no colo.')).toBeInTheDocument();
  });

  it('maskedCaption esconde a glosa da opção e a palavra do enunciado', () => {
    const other = makeSign('PAI', 'Igual ao de mãe, mas na testa: pai.');
    expect(maskedCaption(other, 'MÃE')).toBe('Igual ao de ___, mas na testa: ___.');
  });

  it('maskedCaption esconde também a glosa das outras opções citada na descrição', () => {
    const filha = makeSign('FILHA', 'Feche os dedos no peito, como no sinal FILHO.');
    expect(maskedCaption(filha, 'BEBÊ', [filha, FILHO, BEBE, PAI])).toBe('Feche os dedos no peito, como no sinal ___.');
    // sem FILHO entre as opções, a citação fica
    expect(maskedCaption(filha, 'BEBÊ', [filha, BEBE, PAI, MAE])).toBe('Feche os dedos no peito, como no sinal FILHO.');
  });

  it('o cartão não mostra a citação de outra opção antes de responder', () => {
    mock.set({ status: 'error', error: 'offline' });
    const filha = makeSign('FILHA', 'Feche os dedos no peito, como no sinal FILHO.');
    render(<ExerciseWordChooseVideo word="BEBÊ" sign={BEBE} options={[filha, FILHO, BEBE, PAI]} onAnswer={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('Feche os dedos no peito, como no sinal ___.')).toBeInTheDocument();
    expect(screen.queryByText(/sinal FILHO/)).not.toBeInTheDocument();
  });
});
