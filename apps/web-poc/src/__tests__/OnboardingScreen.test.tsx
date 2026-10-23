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

  it('persiste o nome no localStorage ao concluir o onboarding', async () => {
    await completeOnboarding(vi.fn(), 'Joao');
    expect(localStorage.getItem('librax_displayName')).toBe('Joao');
  });
});
