import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { openDB } from 'idb';
import { PracticeScreen } from '../screens/PracticeScreen';
import { IdbRepo } from '../lib/idbRepo';
import { upgradeLibraxDb } from '../lib/db';
import { course, signsMap } from '../lib/content';
import { getToday } from '../lib/today';
import { getDailyQueue } from '@usecases/getDailyQueue.js';
import { addDays } from '@apilib/dates.js';

// Aba Praticar (spec-03 11.12 e seção 6): cada resposta da revisão vai para o SRS do sinal pelo
// domínio (reviewSigns), sobre o IdbRepo de verdade (fake-indexeddb). A prática livre não mexe no SRS.

const USER = 'user-pratica';
const SIGN = 'sinal-PAI';
const GLOSS = signsMap[SIGN].gloss;

let repo: IdbRepo;
let today: string;

interface SrsRow { ef: number; reps: number; interval: number; dueAt: string }

beforeEach(async () => {
  const db = await openDB(`librax-pratica-${Date.now()}-${Math.random()}`, 2, { upgrade: upgradeLibraxDb });
  repo = new IdbRepo(db, USER);
  today = getToday();
  // terceira revisão de PAI, devida hoje
  await repo.saveSrsItem(USER, SIGN, { ef: 2.5, reps: 2, interval: 3, dueAt: today });
});

const queueOn = async (day: string) =>
  ((await getDailyQueue(repo, course, { userId: USER, today: day, size: 8 })) as { signId: string; kind: string }[])
    .filter((q) => q.kind === 'review')
    .map((q) => q.signId);

async function startReview() {
  render(<PracticeScreen userId={USER} repo={repo} onOpenCamera={() => {}} />);
  await userEvent.click(await screen.findByRole('button', { name: /iniciar revisão/i }));
}

const choiceButtons = () => screen.getAllByRole('button').filter((b) => b.classList.contains('mc-choice'));

describe('PracticeScreen: revisão grava o SRS', () => {
  it('lista o sinal devido hoje', async () => {
    render(<PracticeScreen userId={USER} repo={repo} onOpenCamera={() => {}} />);
    expect(await screen.findByText(GLOSS)).toBeInTheDocument();
    expect(await queueOn(today)).toEqual([SIGN]);
  });

  it('acerto: o sinal sai da fila de hoje e volta em hoje + round(intervalo * ef)', async () => {
    await startReview();
    await userEvent.click(screen.getByRole('button', { name: GLOSS }));

    await waitFor(async () => expect(((await repo.getSrsItem(USER, SIGN)) as SrsRow).reps).toBe(3));
    const item = (await repo.getSrsItem(USER, SIGN)) as SrsRow;
    expect(item.interval).toBe(8); // round(3 * 2.6)
    expect(item.dueAt).toBe(addDays(today, 8));

    expect(await queueOn(today)).not.toContain(SIGN);
    expect(await queueOn(addDays(today, 7))).not.toContain(SIGN);
    expect(await queueOn(addDays(today, 8))).toContain(SIGN);
  });

  it('erro: o sinal volta amanhã, mais cedo que no acerto', async () => {
    await startReview();
    const wrong = choiceButtons().find((b) => b.textContent !== GLOSS)!;
    await userEvent.click(wrong);

    await waitFor(async () => expect(((await repo.getSrsItem(USER, SIGN)) as SrsRow).reps).toBe(0));
    const item = (await repo.getSrsItem(USER, SIGN)) as SrsRow;
    expect(item.interval).toBe(1);
    expect(item.ef).toBe(2.5);
    expect(item.dueAt).toBe(addDays(today, 1));

    expect(await queueOn(today)).not.toContain(SIGN);
    expect(await queueOn(addDays(today, 1))).toContain(SIGN);
  });

  it('sinal novo da fila respondido ganha item no SRS', async () => {
    await startReview();
    await userEvent.click(screen.getByRole('button', { name: GLOSS }));
    await userEvent.click(await screen.findByRole('button', { name: /continuar/i }));

    // segundo item da fila: o primeiro sinal novo do currículo
    const [, second] = (await getDailyQueue(repo, course, { userId: USER, today, size: 8 })) as { signId: string }[];
    expect(second).toBeDefined();
    await userEvent.click(choiceButtons()[0]);
    await waitFor(async () => expect(await repo.listSrsItems(USER)).toHaveLength(2));
  });

  it('não concede XP nem mexe na ofensiva', async () => {
    await startReview();
    await userEvent.click(screen.getByRole('button', { name: GLOSS }));
    await waitFor(async () => expect(((await repo.getSrsItem(USER, SIGN)) as SrsRow).reps).toBe(3));
    expect(await repo.getDayXp(USER, today)).toBe(0);
    expect(await repo.getProfile(USER)).toBeNull();
  });
});

describe('PracticeScreen: prática livre', () => {
  it('usa os sinais já vistos e não afeta o SRS', async () => {
    render(<PracticeScreen userId={USER} repo={repo} onOpenCamera={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /^praticar$/i }));

    // só PAI foi visto: a sessão livre tem um exercício só, com PAI
    expect(screen.getByText('0/1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: GLOSS }));
    await userEvent.click(await screen.findByRole('button', { name: /continuar/i }));
    expect(await screen.findByText(/prática concluída/i)).toBeInTheDocument();

    const item = (await repo.getSrsItem(USER, SIGN)) as SrsRow;
    expect(item).toMatchObject({ ef: 2.5, reps: 2, interval: 3, dueAt: today });
    expect(await repo.listSrsItems(USER)).toHaveLength(1);
  });
});
