import { UndoService, changedRows, canonical } from '../src/mini-app/undo.service';
import { resolvePending } from '../src/expenses/pending-actions';
import { BudgetInput } from '../src/mini-app/mini-app.controller';
import { validate } from 'class-validator';

const tables = ['expense', 'pendingExpense', 'merchantRule', 'monthlyBudget'] as const;
function setup() {
  const data: Record<string, any[]> = Object.fromEntries([...tables, 'undoAction'].map(t => [t, []]));
  const match = (row: any, where: any) => Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object') return v.gt ? new Date(row[k]) > v.gt : v.lt ? new Date(row[k]) < v.lt : true;
    return row[k] === v;
  });
  const tx: any = {};
  for (const table of [...tables, 'undoAction']) tx[table] = {
    findMany: jest.fn(async ({ where }) => data[table].filter(r => match(r, where))),
    findFirst: jest.fn(async ({ where }) => data[table].find(r => match(r, where)) ?? null),
    create: jest.fn(async ({ data: input }) => { const row = { id: 'action', undoneAt: null, ...input }; data[table].push(row); return row; }),
    update: jest.fn(async ({ where, data: input }) => { const row = data[table].find(r => match(r, where)); Object.assign(row, input); return row; }),
    upsert: jest.fn(async ({ where, create, update }) => { const row = data[table].find(r => match(r, where)); if (row) Object.assign(row, update); else data[table].push(create); }),
    deleteMany: jest.fn(async ({ where }) => { data[table] = data[table].filter(r => !match(r, where)); }),
  };
  const prisma = { $transaction: jest.fn(async callback => callback(tx)) };
  return { data, tx, service: new UndoService(prisma as any), prisma };
}

describe('persistent undo', () => {
  it('restores a deleted expense with its original ID, amount, date and category', async () => {
    const { data, tx, service } = setup();
    const row = { id: 'deleted', userId: 'u', amount: '12.50', categoryId: 'food', transactionDate: '2025-01-01T10:00:00.000Z' };
    data.expense.push(row);
    const action = await service.run('u', async () => { await tx.expense.deleteMany({ where: { id: row.id, userId: 'u' } }); return {}; });
    expect(data.expense).toEqual([]);
    await service.undo('u', action.undoId!);
    expect(data.expense).toEqual([row]);
  });
  it('restores a bulk category change and rule, removes new expenses, and is single-use', async () => {
    const { data, service } = setup();
    data.expense.push({ id: 'one', userId: 'u', categoryId: 'old' }, { id: 'two', userId: 'u', categoryId: 'old' });
    data.merchantRule.push({ id: 'rule', userId: 'u', categoryId: 'old' });
    const result = await service.run('u', async () => {
      data.expense.forEach(row => row.categoryId = 'new');
      data.merchantRule[0].categoryId = 'new';
      data.expense.push({ id: 'new-expense', userId: 'u', categoryId: 'new' });
      return { ok: true };
    });
    expect(result.undoId).toBe('action');
    await service.undo('u', 'action');
    expect(data.expense).toEqual([{ id: 'one', userId: 'u', categoryId: 'old' }, { id: 'two', userId: 'u', categoryId: 'old' }]);
    expect(data.merchantRule[0].categoryId).toBe('old');
    await expect(service.undo('u', 'action')).rejects.toThrow();
  });
  it('refuses to overwrite a later edit and does not partially restore other rows', async () => {
    const { data, tx, service } = setup();
    data.expense.push({ id: 'one', userId: 'u', amount: '1' });
    await service.run('u', async () => { data.expense[0].amount = '2'; return {}; });
    data.expense[0].amount = '3';
    await expect(service.undo('u', 'action')).rejects.toThrow('Данные уже изменились');
    expect(tx.expense.upsert).not.toHaveBeenCalled();
    expect(data.expense[0].amount).toBe('3');
  });
  it('rejects another owner and expired actions', async () => {
    const { data, service } = setup();
    await service.run('u', async () => { data.monthlyBudget.push({ id: 'budget', userId: 'u', amount: '100', currency: 'EUR', month: '2026-09' }); return {}; });
    await expect(service.undo('another', 'action')).rejects.toThrow();
    data.undoAction[0].expiresAt = new Date(0);
    await expect(service.undo('u', 'action')).rejects.toThrow();
  });
  it('compares JSON regardless of PostgreSQL object key order', () => {
    expect(canonical({ id: 'x', amount: '2' })).toBe(canonical({ amount: '2', id: 'x' }));
    const blank = { expense: [], pendingExpense: [], merchantRule: [], monthlyBudget: [] };
    expect(changedRows(blank, blank)).toEqual([]);
  });
});

describe('pending purchase concurrency', () => {
  it('rejects repeated confirmation from either chat or Mini App', async () => {
    const tx: any = { pendingExpense: { findUnique: jest.fn().mockResolvedValue({ id: 'p', userId: 'u', amount: '5' }), updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 }) }, expense: { create: jest.fn().mockResolvedValue({ id: 'expense' }) } };
    await resolvePending(tx, 'p', 'confirm', 'u');
    await expect(resolvePending(tx, 'p', 'confirm', 'u')).rejects.toThrow('уже обработана');
    await expect(resolvePending(tx, 'p', 'ignore', 'u')).rejects.toThrow('уже обработана');
    expect(tx.expense.create).toHaveBeenCalledTimes(1);
    await expect(resolvePending(tx, 'p', 'confirm', 'other')).rejects.toThrow('не найдена');
  });
});

describe('budget validation', () => {
  it('accepts removal and refuses invalid periods, fractions and amounts', async () => {
    expect(await validate(Object.assign(new BudgetInput(), { month: '2026-09', currency: 'EUR', amount: 0 }))).toHaveLength(0);
    for (const fields of [{ month: '2026-13' }, { currency: 'eur' }, { amount: -1 }, { amount: 1.001 }]) {
      expect((await validate(Object.assign(new BudgetInput(), { month: '2026-09', currency: 'EUR', amount: 100 }, fields))).length).toBeGreaterThan(0);
    }
  });
});
