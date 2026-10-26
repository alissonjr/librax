import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ContrastPair, Sign } from '../lib/content';
import { signsMap } from '../lib/content';

// A câmera de cada sinal é o exercício de câmera de sempre: aqui, um botão que diz qual abriu
vi.mock('../components/ExerciseCameraSign', () => ({
  ExerciseCameraSign: ({ sign, recognizer, onComplete }: { sign: Sign; recognizer?: string; onComplete: (c: boolean) => void }) => (
    <div>
      <p>{`câmera ${sign.gloss} ${recognizer ?? 'letras'}`}</p>
      <button onClick={() => onComplete(true)}>{`fez ${sign.gloss}`}</button>
      <button onClick={() => onComplete(false)}>{`pulou ${sign.gloss}`}</button>
    </div>
  ),
}));
vi.mock('../components/ExerciseCameraMotionLetter', () => ({
  ExerciseCameraMotionLetter: ({ sign, onComplete }: { sign: Sign; onComplete: (c: boolean) => void }) => (
    <div>
      <p>{`câmera ${sign.gloss} letras-mov`}</p>
      <button onClick={() => onComplete(true)}>{`fez ${sign.gloss}`}</button>
    </div>
  ),
}));
vi.mock('../components/ExerciseCameraMotionSign', () => ({
  ExerciseCameraMotionSign: () => null,
}));

import { ExerciseContrastPair, type ContrastPairResult } from '../components/ExerciseContrastPair';

const F = signsMap['letra-F'];
const T = signsMap['letra-T'];
const K = signsMap['letra-K'];
const H = signsMap['letra-H'];
const ZERO = signsMap['numero-0'];
const O = signsMap['letra-O'];

const ftPair: ContrastPair = {
  signIds: ['letra-F', 'letra-T'],
  rounds: [
    { target: 'letra-T', order: ['letra-F', 'letra-T'] },
    { target: 'letra-F', order: ['letra-T', 'letra-F'] },
  ],
  camera: [{ signId: 'letra-F', recognizer: 'letras' }],
};

const yes = () => Promise.resolve(true);
const no = () => Promise.resolve(false);

function setup(pair: ContrastPair, signs: [Sign, Sign], cameraAvailable = yes) {
  const onComplete = vi.fn<(r: ContrastPairResult) => void>();
  const onStage = vi.fn();
  render(<ExerciseContrastPair pair={pair} signs={signs} onComplete={onComplete} onStage={onStage} cameraAvailable={cameraAvailable} />);
  return { onComplete, onStage, user: userEvent.setup() };
}

beforeEach(() => vi.clearAllMocks());

describe('ExerciseContrastPair (mãos parecidas)', () => {
  it('1. compara: as duas mãos lado a lado com a forma de cada uma (sem 3D, a descrição)', () => {
    setup(ftPair, [F, T]);
    expect(screen.getByRole('heading', { name: 'Compare as duas mãos' })).toBeInTheDocument();
    expect(screen.getByText('Letra F')).toBeInTheDocument();
    expect(screen.getByText('Letra T')).toBeInTheDocument();
    // a forma de cada mão aparece no cartão e no lugar da mão em 3D (jsdom não tem WebGL)
    expect(screen.getAllByText(`${F.params.CM}.`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`${T.params.CM}.`).length).toBeGreaterThan(0);
    // F e T não têm movimento: sem o botão de tocar o movimento
    expect(screen.queryByRole('button', { name: /movimento/ })).not.toBeInTheDocument();
  });

  it('2. checa uma rodada por sinal, com as mãos na ordem sorteada; 3. câmera do F; acerto quando fez tudo', async () => {
    const { onComplete, onStage, user } = setup(ftPair, [F, T]);
    await user.click(screen.getByRole('button', { name: /Entendi/ }));

    // Rodada 1: "Qual é a letra T?", T é a mão 2
    expect(screen.getByRole('heading', { name: 'Qual é a letra T?' })).toBeInTheDocument();
    expect(screen.getByText('Rodada 1 de 2')).toBeInTheDocument();
    const hands = screen.getAllByRole('button', { name: /^Mão \d/ });
    expect(hands).toHaveLength(2);
    // antes de responder, a mão não diz qual letra é
    expect(screen.queryByText('Letra T')).not.toBeInTheDocument();
    await user.click(hands[1]);
    expect(screen.getByText('Correto!')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Rodada 2: "Qual é a letra F?", F é a mão 2
    expect(screen.getByRole('heading', { name: 'Qual é a letra F?' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[1]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // Câmera: só o F (o T não tem câmera), com o classificador das letras paradas, no palco escuro
    expect(await screen.findByText('câmera F letras')).toBeInTheDocument();
    expect(onStage).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'fez F' }));
    expect(onComplete).toHaveBeenCalledWith({ correct: true, missed: [] });
  });

  it('erro na checagem: mostra a mão certa, e o sinal errado revisa mais cedo', async () => {
    const { onComplete, user } = setup({ ...ftPair, camera: [] }, [F, T]);
    await user.click(screen.getByRole('button', { name: /Entendi/ }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[0]);
    expect(screen.getByText('Quase!')).toBeInTheDocument();
    expect(screen.getByText('A resposta certa é a mão 2.')).toBeInTheDocument();
    expect(screen.getByText('Resposta certa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[1]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    // sem sinal com câmera, termina na checagem
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ correct: false, missed: ['letra-T'] }));
  });

  it('câmera dos dois, cada um com o seu reconhecedor; pular um conta como erro dele', async () => {
    const pair: ContrastPair = {
      signIds: ['letra-K', 'letra-H'],
      rounds: [
        { target: 'letra-K', order: ['letra-K', 'letra-H'] },
        { target: 'letra-H', order: ['letra-K', 'letra-H'] },
      ],
      camera: [{ signId: 'letra-K', recognizer: 'letras-mov' }, { signId: 'letra-H', recognizer: 'letras' }],
    };
    const { onComplete, user } = setup(pair, [K, H]);
    // K e H têm movimento: o botão toca o das duas mãos
    expect(screen.getAllByText('Com movimento')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /movimento/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Entendi/ }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[0]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[1]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    expect(await screen.findByText('câmera K letras-mov')).toBeInTheDocument();
    expect(screen.getByText('Mãos parecidas: 1 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'fez K' }));
    expect(screen.getByText('câmera H letras')).toBeInTheDocument();
    expect(screen.getByText('Mãos parecidas: 2 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'pulou H' }));
    expect(onComplete).toHaveBeenCalledWith({ correct: false, missed: ['letra-H'] });
  });

  it('sem câmera no aparelho, a etapa da câmera é pulada sem contar erro', async () => {
    const { onComplete, onStage, user } = setup(ftPair, [F, T], no);
    await user.click(screen.getByRole('button', { name: /Entendi/ }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[1]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await user.click(screen.getAllByRole('button', { name: /^Mão \d/ })[1]);
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ correct: true, missed: [] }));
    expect(screen.queryByText(/câmera F/)).not.toBeInTheDocument();
    expect(onStage).not.toHaveBeenCalledWith(true);
  });

  it('mesma mão (0 e O): avisa que a mão é a mesma e a checagem pergunta pelo contexto', async () => {
    const pair: ContrastPair = {
      signIds: ['numero-0', 'letra-O'],
      rounds: [
        { target: 'letra-O', order: ['numero-0', 'letra-O'] },
        { target: 'numero-0', order: ['letra-O', 'numero-0'] },
      ],
      contexts: { 'numero-0': '10', 'letra-O': 'BOLO' },
      camera: [{ signId: 'numero-0', recognizer: 'numeros' }, { signId: 'letra-O', recognizer: 'letras' }],
    };
    const { onComplete, user } = setup(pair, [ZERO, O]);
    expect(screen.getByText('Mesma mão')).toBeInTheDocument();
    expect(screen.getByText(/Quem diz se é letra ou número é o contexto/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Entendi/ }));

    expect(screen.getByRole('heading', { name: 'Esta mão aparece na palavra BOLO. O que ela é?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Letra O' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(screen.getByRole('heading', { name: 'Esta mão aparece no número 10. O que ela é?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Número 0' }));
    await user.click(screen.getByRole('button', { name: 'Continuar' }));

    // o 0 com o modelo dos números, o O com o das letras
    expect(await screen.findByText('câmera 0 numeros')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'fez 0' }));
    expect(screen.getByText('câmera O letras')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'fez O' }));
    expect(onComplete).toHaveBeenCalledWith({ correct: true, missed: [] });
  });
});
