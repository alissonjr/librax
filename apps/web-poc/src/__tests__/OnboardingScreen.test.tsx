import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingScreen } from '../screens/OnboardingScreen';

beforeEach(() => {
  localStorage.clear();
});

async function completeOnboarding(onDone = vi.fn(), name = 'Joao') {
  render(<OnboardingScreen onDone={onDone} />);
  // Passo 1: nome
  await userEvent.type(screen.getByPlaceholderText(/como posso/i), name);
  await userEvent.click(screen.getByRole('button', { name: /começar/i }));
  // Passo 2: motivo (seleciona por texto; ha botoes de idioma no topo)
  await userEvent.click(screen.getByRole('button', { name: /familiar ou amigo surdo/i }));
  await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
  // Passo 3: meta
  await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
  // Passo 4: camera
  await userEvent.click(screen.getByRole('button', { name: /usar câmera/i }));
  // Passo 5: convite do teste de nivelamento (recusado)
  await userEvent.click(screen.getByRole('button', { name: /começar do início/i }));
}

describe('OnboardingScreen', () => {
  it('renderiza campo de nome e botao de inicio no passo 1', () => {
    render(<OnboardingScreen onDone={vi.fn()} />);
    expect(screen.getByPlaceholderText(/como posso/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /começar/i })).toBeInTheDocument();
  });

  it('avanca para passo 2 ao clicar em Comecar', async () => {
    render(<OnboardingScreen onDone={vi.fn()} />);
    await userEvent.type(screen.getByPlaceholderText(/como posso/i), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: /começar/i }));
    expect(screen.getByText(/por que você quer aprender/i)).toBeInTheDocument();
  });

  it('chama onDone ao concluir todos os 4 passos', async () => {
    const onDone = vi.fn();
    await completeOnboarding(onDone, 'Maria');
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('o convite do teste de nivelamento é uma escolha de mesmo peso, e só ao escolher o onboarding termina', async () => {
    const onDone = vi.fn();
    render(<OnboardingScreen onDone={onDone} />);
    await userEvent.type(screen.getByPlaceholderText(/como posso/i), 'Bia');
    await userEvent.click(screen.getByRole('button', { name: /começar/i }));
    await userEvent.click(screen.getByRole('button', { name: /familiar ou amigo surdo/i }));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.click(screen.getByRole('button', { name: /agora não/i }));
    expect(screen.getByText(/já conhece o alfabeto manual/i)).toBeInTheDocument();
    // Ainda não gravou o nome: trocar o idioma aqui não pula para o mapa
    expect(localStorage.getItem('librax_displayName')).toBeNull();
    const fromStart = screen.getByRole('button', { name: /começar do início/i });
    const test = screen.getByRole('button', { name: /já sei o alfabeto\? fazer um teste rápido/i });
    expect(fromStart.className).toBe(test.className);
    await userEvent.click(test);
    expect(onDone).toHaveBeenCalledWith('placement');
    expect(localStorage.getItem('librax_displayName')).toBe('Bia');
  });

  it('as boas-vindas levam aos Termos de Uso e à Política de Privacidade', () => {
    render(<OnboardingScreen onDone={vi.fn()} />);
    expect(screen.getByText(/Ao começar, você concorda com os/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Termos de Uso' })).toHaveAttribute('href', '/termos');
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacidade');
  });

  it('persiste o nome no localStorage ao concluir o onboarding', async () => {
    await completeOnboarding(vi.fn(), 'Joao');
    expect(localStorage.getItem('librax_displayName')).toBe('Joao');
  });
});
