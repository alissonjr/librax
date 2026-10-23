import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Nav } from '../components/Nav';

describe('Nav', () => {
  it('renderiza as 4 secoes de navegacao', () => {
    render(<Nav active="aprender" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /aprender/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /praticar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /social/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /perfil/i })).toBeInTheDocument();
  });

  it('chama onNavigate com "praticar" ao clicar em Praticar', async () => {
    const onNavigate = vi.fn();
    render(<Nav active="aprender" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: /praticar/i }));
    expect(onNavigate).toHaveBeenCalledWith('praticar');
  });

  it('chama onNavigate com "perfil" ao clicar em Perfil', async () => {
    const onNavigate = vi.fn();
    render(<Nav active="aprender" onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: /perfil/i }));
    expect(onNavigate).toHaveBeenCalledWith('perfil');
  });

  it('marca o item ativo com aria-current', () => {
    render(<Nav active="social" onNavigate={vi.fn()} />);
    const socialBtn = screen.getByRole('button', { name: /social/i });
    expect(socialBtn).toHaveAttribute('aria-current', 'page');
  });

  it('nao marca outros itens com aria-current quando social e ativo', () => {
    render(<Nav active="social" onNavigate={vi.fn()} />);
    expect(screen.getByRole('button', { name: /aprender/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /praticar/i })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: /perfil/i })).not.toHaveAttribute('aria-current');
  });
});
