import { describe, it, expect, vi } from 'vitest';
import type { ReactElement } from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Dialog } from '../components/Dialog';

// Sheets e diálogos usam o histórico do roteador (useCloseOnBack)
const render = (ui: ReactElement) => rtlRender(ui, {
  wrapper: ({ children }) => (
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{children}</MemoryRouter>
  ),
});

describe('Dialog', () => {
  it('nao renderiza quando isOpen=false', () => {
    render(
      <Dialog
        isOpen={false}
        title="Titulo"
        message="Mensagem"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText('Titulo')).not.toBeInTheDocument();
  });

  it('renderiza titulo e mensagem quando isOpen=true', () => {
    render(
      <Dialog
        isOpen={true}
        title="Sair da licao?"
        message="Seu progresso sera perdido."
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('Sair da licao?')).toBeInTheDocument();
    expect(screen.getByText('Seu progresso sera perdido.')).toBeInTheDocument();
  });

  it('chama onConfirm ao clicar no botao de confirmacao', async () => {
    const onConfirm = vi.fn();
    render(
      <Dialog
        isOpen={true}
        title="Confirmar"
        message="Tem certeza?"
        confirmLabel="Sim"
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Sim' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('chama onCancel ao clicar no botao de cancelamento', async () => {
    const onCancel = vi.fn();
    render(
      <Dialog
        isOpen={true}
        title="Confirmar"
        message="Tem certeza?"
        cancelLabel="Nao"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Nao' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('nao exibe botao cancelar quando onCancel nao e fornecido', () => {
    render(
      <Dialog
        isOpen={true}
        title="Aviso"
        message="Ok"
        confirmLabel="OK"
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /cancelar|nao|sair/i })).not.toBeInTheDocument();
  });
});
