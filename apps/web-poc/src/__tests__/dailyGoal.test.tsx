import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { openDB } from 'idb';

// O avatar VLibras não roda no jsdom
vi.mock('../lib/vlibras', () => ({
  VLIBRAS_SITE_URL: 'https://www.vlibras.gov.br/',
  VLIBRAS_LICENSE_URL: 'https://www.gnu.org/licenses/lgpl-3.0.html',
  VLIBRAS_SPEEDS: [1, 0.75, 0.5],
  getVlibrasState: () => ({ status: 'error', progress: 0, playing: false, speed: 1, error: 'sem avatar' }),
  subscribeVlibras: () => () => {},
  attachVlibras: () => () => {},
  play: async () => false,
  retryVlibras: () => {},
  stopVlibras: () => {},
  setVlibrasSpeed: () => {},
}));

import { SettingsScreen } from '../screens/SettingsScreen';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { __resetAccountForTests } from '../lib/account';
import { dailyGoalOf, loadDailyGoal, saveDailyGoal, DEFAULT_DAILY_GOAL } from '../lib/dailyGoal';

let repo: IdbRepo;

beforeEach(async () => {
  // Banco novo por teste
  const db = await openDB(`librax-goal-${Date.now()}-${Math.random()}`, 1, { upgrade: upgradeLibraxDb });
  repo = new IdbRepo(db, 'usr-1');
  localStorage.clear();
  localStorage.setItem('librax_displayName', 'Ana');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('meta diária no perfil local', () => {
  it('sem perfil ou sem valor válido, vale a padrão (20)', async () => {
    expect(await loadDailyGoal(repo, 'usr-1')).toBe(DEFAULT_DAILY_GOAL);
    expect(dailyGoalOf({ dailyGoalXp: 'muito' })).toBe(DEFAULT_DAILY_GOAL);
    expect(dailyGoalOf({ dailyGoalXp: 0 })).toBe(DEFAULT_DAILY_GOAL);
    expect(dailyGoalOf({ dailyGoalXp: 50 })).toBe(50);
  });

  it('gravar a meta mantém XP, sequência e conquistas do perfil', async () => {
    await repo.saveProfile({ userId: 'usr-1', xpTotal: 80, streak: 2, dailyGoalXp: 20, achievements: ['first_lesson'] });
    await saveDailyGoal(repo, 'usr-1', 5);
    expect(await repo.getProfile('usr-1')).toEqual({
      userId: 'usr-1', xpTotal: 80, streak: 2, dailyGoalXp: 5, achievements: ['first_lesson'],
    });
    expect(await loadDailyGoal(repo, 'usr-1')).toBe(5);
  });
});

describe('Configurações: meta diária', () => {
  function renderSettings() {
    __resetAccountForTests({ status: 'unavailable', email: null });
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SettingsScreen userId="usr-1" repo={repo} onBack={() => {}} />
      </MemoryRouter>,
    );
  }

  it('mostra a meta guardada (a das boas-vindas) e grava a nova escolha', async () => {
    await repo.saveProfile({ userId: 'usr-1', xpTotal: 30, dailyGoalXp: 50, achievements: ['first_lesson'] });
    renderSettings();
    const select = screen.getByRole('combobox', { name: /meta diária/i });
    await waitFor(() => expect(select).toHaveValue('50'));

    await userEvent.selectOptions(select, '10');
    expect(select).toHaveValue('10');
    await waitFor(async () => expect(await loadDailyGoal(repo, 'usr-1')).toBe(10));
    expect(await repo.getProfile('usr-1')).toMatchObject({ xpTotal: 30, achievements: ['first_lesson'] });
  });

  it('sem meta guardada, mostra a padrão', async () => {
    renderSettings();
    const select = screen.getByRole('combobox', { name: /meta diária/i });
    await waitFor(() => expect(select).toHaveValue(String(DEFAULT_DAILY_GOAL)));
  });
});
