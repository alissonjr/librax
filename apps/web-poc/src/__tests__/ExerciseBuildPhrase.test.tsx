import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseBuildPhrase } from '../components/ExerciseBuildPhrase';

const glosses = ['ONDE', 'MORAR', 'VOCÊ?'];
// Banco embaralhado com um distrator (NOME)
const tiles = ['VOCÊ?', 'NOME', 'MORAR', 'ONDE'];

function setup(over: Partial<Parameters<typeof ExerciseBuildPhrase>[0]> = {}) {
  const onAnswer = vi.fn();
  const onNext = vi.fn();
  render(
    <ExerciseBuildPhrase pt="Onde você mora?" glosses={glosses} tiles={tiles} onAnswer={onAnswer} onNext={onNext} {...over} />,
  );
  const bank = screen.getByRole('group', { name: /blocos de glosa/i });
  const answer = screen.getByRole('group', { name: /sua frase em libras/i });
  const tap = (gloss: string) => userEvent.click(within(bank).getByRole('button', { name: gloss }));
  return { onAnswer, onNext, bank, answer, tap };
}

describe('ExerciseBuildPhrase', () => {
  it('mostra a traducao em portugues, todos os blocos e a nota sobre a ordem da Libras', () => {
    const { bank } = setup();
    expect(screen.getByText('Onde você mora?')).toBeInTheDocument();
    expect(within(bank).getAllByRole('button')).toHaveLength(tiles.length);
    expect(screen.getByText(/ordem própria/i)).toBeInTheDocument();
  });

  it('confirmar fica desabilitado ate colocar um bloco', async () => {
    const { tap } = setup();
    const confirm = screen.getByRole('button', { name: /confirmar frase/i });
    expect(confirm).toBeDisabled();
    await tap('ONDE');
    expect(confirm).toBeEnabled();
  });

  it('tocar num bloco leva para a frase e tocar de novo devolve ao banco', async () => {
    const { answer, bank, tap } = setup();
    await tap('MORAR');
    expect(within(answer).getByRole('button', { name: /tirar morar/i })).toBeInTheDocument();
    expect(within(bank).queryByRole('button', { name: 'MORAR' })).toBeNull();

    await userEvent.click(within(answer).getByRole('button', { name: /tirar morar/i }));
    expect(within(answer).queryByRole('button')).toBeNull();
    expect(within(bank).getByRole('button', { name: 'MORAR' })).toBeInTheDocument();
  });

  it('ordem certa chama onAnswer(true) e mostra o feedback de acerto', async () => {
    const { tap, onAnswer, onNext } = setup();
    await tap('ONDE');
    await tap('MORAR');
    await tap('VOCÊ?');
    await userEvent.click(screen.getByRole('button', { name: /confirmar frase/i }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    expect(screen.getByText(/frase certa/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('ordem do portugues e errada: chama onAnswer(false) e mostra a ordem certa', async () => {
    const { tap, onAnswer } = setup();
    await tap('ONDE');
    await tap('VOCÊ?');
    await tap('MORAR');
    await userEvent.click(screen.getByRole('button', { name: /confirmar frase/i }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    const correct = screen.getByRole('list', { name: /ordem certa/i });
    expect(within(correct).getAllByRole('listitem').map((li) => li.textContent)).toEqual(glosses);
  });

  it('usar o distrator conta como erro', async () => {
    const { tap, onAnswer } = setup();
    await tap('ONDE');
    await tap('MORAR');
    await tap('VOCÊ?');
    await tap('NOME');
    await userEvent.click(screen.getByRole('button', { name: /confirmar frase/i }));
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('glosa repetida na frase vale em qualquer um dos blocos iguais', async () => {
    const onAnswer = vi.fn();
    render(
      <ExerciseBuildPhrase
        pt="Sábado eu vou à praia."
        glosses={['SÁBADO', 'EU', 'IR', 'PRAIA', 'EU']}
        tiles={['EU', 'PRAIA', 'EU', 'IR', 'SÁBADO']}
        onAnswer={onAnswer}
        onNext={vi.fn()}
      />,
    );
    const bank = screen.getByRole('group', { name: /blocos de glosa/i });
    for (const g of ['SÁBADO', 'EU', 'IR', 'PRAIA', 'EU']) {
      await userEvent.click(within(bank).getAllByRole('button', { name: g })[0]);
    }
    await userEvent.click(screen.getByRole('button', { name: /confirmar frase/i }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });

  it('depois de responder os blocos nao mudam mais', async () => {
    const { tap, answer } = setup();
    await tap('ONDE');
    await userEvent.click(screen.getByRole('button', { name: /confirmar frase/i }));
    expect(within(answer).getByRole('button', { name: /tirar onde/i })).toBeDisabled();
  });
});
