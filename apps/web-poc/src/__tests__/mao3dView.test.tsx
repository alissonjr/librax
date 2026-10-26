import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Motor 3D mockado (sem WebGL no jsdom): o teste vê o que a tela pede a ele
const m = vi.hoisted(() => ({
  fail: false,
  created: [] as { opts: { reduced: boolean; tone: number; playing: boolean }; clip: { gloss: string; moving: boolean } }[],
  motor: {
    setPlaying: vi.fn(), setSpeed: vi.fn(), setPerson: vi.fn(), setTone: vi.fn(),
    rotateBy: vi.fn(), resetView: vi.fn(), seek: vi.fn(), dispose: vi.fn(),
  },
}));

vi.mock('../mao3d/motor', () => ({
  ROTATE_STEP: Math.PI / 6,
  createMotor: vi.fn(async (_c: unknown, _o: unknown, clip: { gloss: string; moving: boolean }, _model: unknown, opts: { reduced: boolean; tone: number; playing: boolean }) => {
    if (m.fail) throw new Error('sem WebGL');
    m.created.push({ clip, opts });
    return m.motor;
  }),
}));

// Avatar VLibras mockado (aba "Avatar"); estado fixo (o useSyncExternalStore compara por referência)
const VL_STATE = vi.hoisted(() => ({ status: 'idle', progress: 0, playing: false, speed: 1, error: null }));
vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => VL_STATE,
  subscribeVlibras: () => () => {},
  attachVlibras: vi.fn(() => vi.fn()),
  play: vi.fn(async () => true),
  retryVlibras: vi.fn(),
  stopVlibras: vi.fn(),
  setVlibrasSpeed: vi.fn(),
}));

import Mao3DView, { loadHandModel } from '../mao3d/Mao3DView';
import { HandDemo } from '../components/HandDemo';
import { ExerciseIntro } from '../components/ExerciseIntro';
import { getSign } from '../lib/content';
import { setWebglAvailableForTests, getSkinTone } from '../mao3d/disponivel';

function mockMatchMedia(reduce: boolean) {
  window.matchMedia = vi.fn((q: string) => ({
    matches: reduce && q.includes('reduce'), media: q, onchange: null,
    addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

beforeEach(async () => {
  m.fail = false;
  m.created = [];
  Object.values(m.motor).forEach((f) => f.mockClear());
  localStorage.clear();
  mockMatchMedia(false);
  // O modelo (GLB) vem por fetch: devolve uns bytes quaisquer (o motor é mockado)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))));
  await loadHandModel().catch(() => {});
});
afterEach(() => {
  setWebglAvailableForTests(null);
  vi.unstubAllGlobals();
});

describe('Mao3DView', () => {
  it('letra parada: gira sozinha, sem 0,5x, com outra mão, tom e giro pelos botões', async () => {
    const onError = vi.fn();
    render(<Mao3DView sign={getSign('letra-A')} onError={onError} />);
    await screen.findByRole('button', { name: 'Girar a mão para a direita' });
    expect(m.created[0].clip).toMatchObject({ gloss: 'A', moving: false });
    expect(m.created[0].opts.playing).toBe(true);
    expect(screen.getByRole('img', { name: /Mão em 3D fazendo a letra A: Punho fechado/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Velocidade/ })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Girar a mão para a direita' }));
    expect(m.motor.rotateBy).toHaveBeenCalledWith(Math.PI / 6, 0);
    // Mexeu na vista: a mão parada para de girar sozinha
    await waitFor(() => expect(m.motor.setPlaying).toHaveBeenLastCalledWith(false));
    await userEvent.click(screen.getByRole('button', { name: 'Ver a mão de frente' }));
    expect(m.motor.resetView).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Mostrar a mão de outra pessoa \(agora 1 de/ }));
    await waitFor(() => expect(m.motor.setPerson).toHaveBeenLastCalledWith(1));

    await userEvent.click(screen.getByRole('button', { name: 'Tom de pele da mão' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Tom 5 de 6' }));
    await waitFor(() => expect(m.motor.setTone).toHaveBeenLastCalledWith(4));
    expect(getSkinTone()).toBe(4);
    expect(onError).not.toHaveBeenCalled();
  });

  it('letra com movimento: tocar e pausar, 0,5x', async () => {
    render(<Mao3DView sign={getSign('letra-J')} onError={vi.fn()} />);
    const play = await screen.findByRole('button', { name: 'Tocar ou pausar o movimento' });
    await waitFor(() => expect(play).toBeEnabled());
    expect(play).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(play);
    await waitFor(() => expect(m.motor.setPlaying).toHaveBeenLastCalledWith(false));
    expect(screen.getByText('Ver o movimento')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Velocidade 1x/ }));
    await waitFor(() => expect(m.motor.setSpeed).toHaveBeenLastCalledWith(0.5));
    expect(screen.getByRole('button', { name: /Velocidade 0,5x/ })).toBeInTheDocument();
  });

  it('H, K e X (câmera avalia a forma parada) mostram o movimento na legenda', async () => {
    render(<Mao3DView sign={getSign('letra-H')} onError={vi.fn()} />);
    expect(await screen.findByText(/Movimento: gira o pulso/)).toBeInTheDocument();
  });

  it('menos movimento: abre parada', async () => {
    mockMatchMedia(true);
    render(<Mao3DView sign={getSign('letra-J')} onError={vi.fn()} />);
    const play = await screen.findByRole('button', { name: 'Tocar ou pausar o movimento' });
    await waitFor(() => expect(m.created).toHaveLength(1));
    expect(m.created[0].opts).toMatchObject({ reduced: true, playing: false });
    expect(play).toHaveAttribute('aria-pressed', 'false');
  });

  it('o tom escolhido antes vale ao abrir', async () => {
    localStorage.setItem('librax_mao3dTom', '5');
    render(<Mao3DView sign={getSign('numero-3')} onError={vi.fn()} />);
    await waitFor(() => expect(m.created).toHaveLength(1));
    expect(m.created[0].opts.tone).toBe(5);
    expect(screen.getByRole('img', { name: /o número 3/ })).toBeInTheDocument();
  });

  it('falha do 3D avisa quem chamou', async () => {
    m.fail = true;
    const onError = vi.fn();
    render(<Mao3DView sign={getSign('letra-A')} onError={onError} />);
    await waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

describe('HandDemo', () => {
  it('sem WebGL: fica a demonstração de sempre (avatar), sem abas', () => {
    setWebglAvailableForTests(false);
    render(<HandDemo sign={getSign('letra-A')} fallback={<p>texto</p>} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('img', { name: /Avatar VLibras/ })).toBeInTheDocument();
  });

  it('letra com avatar: abas Mão 3D | Avatar, abrindo na mão; a escolha fica guardada', async () => {
    setWebglAvailableForTests(true);
    render(<HandDemo sign={getSign('letra-A')} fallback={<p>texto</p>} />);
    const tab3d = screen.getByRole('tab', { name: /Mão 3D/ });
    expect(tab3d).toHaveAttribute('aria-selected', 'true');
    await screen.findByRole('img', { name: /Mão em 3D fazendo a letra A/ });
    await userEvent.click(screen.getByRole('tab', { name: /Avatar/ }));
    expect(screen.getByRole('img', { name: /Avatar VLibras/ })).toBeInTheDocument();
    expect(localStorage.getItem('librax_mao3dAba')).toBe('avatar');
  });

  it('Ç (sem avatar): a mão em 3D é a demonstração, sem abas', async () => {
    setWebglAvailableForTests(true);
    render(<ExerciseIntro sign={getSign('letra-Ç')} onNext={vi.fn()} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(await screen.findByRole('img', { name: /Mão em 3D fazendo a letra Ç/ })).toBeInTheDocument();
  });

  it('se o 3D falhar, volta para o avatar ou a descrição', async () => {
    setWebglAvailableForTests(true);
    m.fail = true;
    render(<HandDemo sign={getSign('letra-Ç')} fallback={<p>descrição da forma</p>} />);
    expect(await screen.findByText('descrição da forma')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('palavras: nada muda (só o avatar)', () => {
    setWebglAvailableForTests(true);
    const word = getSign('sinal-BANANA');
    render(<HandDemo sign={word} fallback={<p>texto</p>} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(m.created).toHaveLength(0);
  });
});
