import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CameraStatsScreen } from '../screens/CameraStatsScreen';
import { clearCameraStats, listCameraStats, recordCameraRun, type CameraRunResult } from '../lib/cameraStats';

// Tela "Desempenho da câmera" (Configurações) sobre o banco do app (fake-indexeddb).

function run(signId: string, label: string, outcome: 'success' | 'skip', wrongReadings: Record<string, number> = {}): CameraRunResult {
  return { signId, label, kind: signId.startsWith('letra-') ? 'letter' : 'sign', outcome, wrongReadings };
}

// O diálogo de confirmação fecha com o voltar do navegador (useCloseOnBack): precisa do roteador
const renderScreen = () => render(<MemoryRouter><CameraStatsScreen onBack={vi.fn()} /></MemoryRouter>);

beforeEach(async () => {
  await clearCameraStats();
});

describe('CameraStatsScreen', () => {
  it('sem dados mostra o estado vazio e nenhum botão de exportar', async () => {
    renderScreen();
    expect(await screen.findByText('Ainda sem números')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exportar/i })).not.toBeInTheDocument();
  });

  it('lista do mais difícil para o mais fácil, com as leituras erradas mais comuns', async () => {
    await recordCameraRun(run('letra-A', 'A', 'success'));
    await recordCameraRun(run('letra-K', 'K', 'skip', { H: 3 }));
    await recordCameraRun(run('letra-K', 'K', 'success', { H: 1, P: 1 }));
    await recordCameraRun(run('sinal-MESA', 'MESA', 'success', { CASA: 2 }));

    renderScreen();
    const list = await screen.findByRole('list', { name: /mais difícil/i });
    const items = within(list).getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(items).toEqual(['Letra K', 'Sinal MESA', 'Letra A']);

    const k = within(list).getAllByRole('listitem')[0];
    expect(within(k).getByText('Difícil')).toBeInTheDocument();
    expect(within(k).getByText('1 de 2 (50%)')).toBeInTheDocument();
    expect(within(k).getByText('3 em média')).toBeInTheDocument();
    expect(within(k).getByText('H (4)')).toBeInTheDocument();
    expect(within(k).getByText('P (1)')).toBeInTheDocument();
    expect(screen.getByText('Pulos: 1')).toBeInTheDocument();
  });

  it('apaga os números depois de confirmar', async () => {
    await recordCameraRun(run('letra-A', 'A', 'skip'));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: /apagar estes números/i }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Apagar' }));
    expect(await screen.findByText('Ainda sem números')).toBeInTheDocument();
    expect(await listCameraStats()).toEqual([]);
  });
});
