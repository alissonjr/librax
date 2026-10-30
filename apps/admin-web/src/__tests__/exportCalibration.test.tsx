import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi } from '../dev/mock';
import { ApiContext } from '../lib/context';
import { ExportCalibration } from '../components/ExportCalibration';
import { buildCalibrationExport, exportFileName, EXPORT_DAYS } from '../lib/exportData';
import type { AdminApi } from '../lib/api';
import type { FeedbackItem } from '../lib/usageTypes';

const item = (rating: number, text: string): FeedbackItem => ({
  at: '2026-10-28T12:00:00Z', day: '2026-10-28', rating, text, lessonsCompleted: 3, currentLessonId: 'u1-l2',
  hasAccount: true, appVersion: '1.0.1', lang: 'pt-BR', platform: 'android', installed: 'yes',
});

afterEach(() => vi.restoreAllMocks());

describe('dados para calibrar', () => {
  it('junta operação de 90 dias, uso, todas as páginas de notas e o catálogo, sem dado de conta', async () => {
    const base = mockApi();
    const overview = vi.spyOn(base, 'overview');
    const pages: Record<string, { items: FeedbackItem[]; cursor: string | null }> = {
      first: { items: [item(5, 'Gostei muito')], cursor: 'p2' },
      p2: { items: [item(2, 'A câmera não pega o F')], cursor: null },
    };
    const api: AdminApi = { ...base, feedback: async ({ cursor } = {}) => pages[cursor ?? 'first'] };
    const listAccounts = vi.spyOn(api, 'listAccounts');

    const out = await buildCalibrationExport(api, () => new Date('2026-10-30T10:00:00Z'));

    expect(out.kind).toBe('librax-calibracao');
    expect(out.windowDays).toBe(EXPORT_DAYS);
    expect(overview).toHaveBeenCalledWith(90);
    expect(out.operation.camera).toBeDefined();
    expect(out.usage.funnel).toBeDefined();
    expect(out.feedback).toEqual({ items: [pages.first.items[0], pages.p2.items[0]], truncated: false });
    expect(out.content.signs.length).toBeGreaterThan(0);
    // Nada de contas: nem a rota é chamada
    expect(listAccounts).not.toHaveBeenCalled();
    expect(JSON.stringify(out)).not.toMatch(/@exemplo\.com/);
  });

  it('nome do arquivo com o dia', () => {
    expect(exportFileName(new Date(2026, 9, 30, 10))).toBe('librax-calibracao-2026-10-30.json');
  });

  it('botão baixa o arquivo e avisa', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<ApiContext.Provider value={mockApi()}><ExportCalibration now={() => new Date(2026, 9, 30)} /></ApiContext.Provider>);
    await userEvent.click(screen.getByRole('button', { name: /Baixar arquivo/ }));
    expect(await screen.findByText(/Arquivo baixado/)).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });

  it('erro ao juntar: avisa e deixa tentar de novo', async () => {
    const api: AdminApi = { ...mockApi(), usage: () => Promise.reject(new Error('falhou')) };
    render(<ApiContext.Provider value={api}><ExportCalibration /></ApiContext.Provider>);
    await userEvent.click(screen.getByRole('button', { name: /Baixar arquivo/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não deu para juntar os dados agora');
    expect(screen.getByRole('button', { name: /Baixar arquivo/ })).toBeEnabled();
  });
});
