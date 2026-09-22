import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import { ExpensesService } from '../src/expenses/expenses.service';

describe('ExpensesService', () => {
  const category = { id: 'cat-1', name: 'Продукты', emoji: '🛒' };
  const user = {
    id: 'user-1',
    telegramId: '451204875',
    defaultCurrency: 'EUR',
    timezone: 'Europe/Nicosia',
  };

  const createService = () => {
    const prisma = {
      $transaction: jest.fn(),
      category: { findFirst: jest.fn().mockResolvedValue({ id: "cat-2" }) },
      user: {
        upsert: jest.fn(),
      },
      pendingExpense: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      expense: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(callback => callback(prisma));
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          TELEGRAM_OWNER_ID: '451204875',
          DEFAULT_CURRENCY: 'EUR',
          DEFAULT_TIMEZONE: 'Europe/Nicosia',
        };
        return values[key] ?? fallback;
      }),
    };
    const categories = {
      applyMerchantCategory: jest.fn().mockResolvedValue(4),
      ensureDefaultMerchantRules: jest.fn(),
      categorizeMerchant: jest.fn(),
      formatCategory: jest.fn((cat?: { emoji?: string; name?: string } | null) =>
        cat ? `${cat.emoji ?? ''} ${cat.name}`.trim() : '❓ Другое',
      ),
    };
    const manualParser = {
      parse: jest.fn(),
    };

    return {
      prisma,
      config,
      categories,
      manualParser,
      service: new ExpensesService(prisma as never, config as never, categories as never, manualParser as never),
    };
  };

  it('queries confirmed expenses for the owner with exclusive timezone-aware boundaries', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-22T12:00:00Z'));
    const { service, prisma } = createService();
    prisma.expense.findMany.mockResolvedValue([]);
    await service.getPeriodReport('user-1', 'w', '20260921');
    expect(prisma.expense.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { userId: 'user-1', transactionDate: {
        gte: new Date('2026-09-20T21:00:00Z'), lt: new Date('2026-09-22T12:00:00Z'),
      } },
    }));
    expect(prisma.expense.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { userId: 'user-1', transactionDate: {
        gte: new Date('2026-09-13T21:00:00Z'), lt: new Date('2026-09-15T12:00:00Z'),
      } },
    }));
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.useRealTimers();
  });

  it('creates owner user from telegram profile and ensures default rules', async () => {
    const { prisma, categories, service } = createService();
    prisma.user.upsert.mockResolvedValue(user);

    await expect(service.getOrCreateOwnerUser({ id: 451204875, username: 'nikita' })).resolves.toBe(user);
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { telegramId: '451204875' },
      update: { username: 'nikita', firstName: undefined },
      create: {
        telegramId: '451204875',
        username: 'nikita',
        firstName: undefined,
        defaultCurrency: 'EUR',
        timezone: 'Europe/Nicosia',
      },
    });
    expect(categories.ensureDefaultMerchantRules).toHaveBeenCalledWith('user-1');
  });

  it('creates pending expense from parsed bank message', async () => {
    const { prisma, categories, service } = createService();
    categories.categorizeMerchant.mockResolvedValue(category);
    prisma.pendingExpense.create.mockResolvedValue({ id: 'pending-1' });

    await service.createPendingFromParsed({
      userId: 'user-1',
      incomingBankMessageId: 'incoming-1',
      parsed: {
        amount: 12.4,
        currency: 'EUR',
        merchant: 'LIDL',
        type: 'expense',
      },
      sourceDate: new Date('2026-05-27T20:12:00Z'),
    });

    expect(prisma.pendingExpense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        incomingBankMessageId: 'incoming-1',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        merchant: 'LIDL',
        categoryId: 'cat-1',
        transactionDate: new Date('2026-05-27T20:12:00Z'),
      }),
    });
  });

  it('creates pending manual expense from parsed text', async () => {
    const { manualParser, service } = createService();
    const createPendingSpy = jest.spyOn(service, 'createPendingFromParsed').mockResolvedValue({ id: 'pending-1' } as never);
    manualParser.parse.mockReturnValue({ amount: 5.5, currency: 'EUR', merchant: 'CAFE', description: 'CAFE' });

    await expect(service.createPendingManualExpense(user as never, '5.50 cafe')).resolves.toEqual({ id: 'pending-1' });
    expect(createPendingSpy).toHaveBeenCalledWith({
      userId: 'user-1',
      parsed: {
        amount: 5.5,
        currency: 'EUR',
        merchant: 'CAFE',
        description: 'CAFE',
        type: 'expense',
      },
      sourceDate: expect.any(Date),
    });
  });

  it('returns undefined for unparsable manual expense', async () => {
    const { manualParser, service } = createService();
    manualParser.parse.mockReturnValue(undefined);

    await expect(service.createPendingManualExpense(user as never, 'no amount')).resolves.toBeUndefined();
  });

  it('confirms pending expense into expense', async () => {
    const { prisma, service } = createService();
    prisma.pendingExpense.findUnique.mockResolvedValue({
      id: 'pending-1',
      userId: 'user-1',
      amount: new Prisma.Decimal(12.4),
      currency: 'EUR',
      merchant: 'LIDL',
      description: null,
      categoryId: 'cat-1',
      transactionDate: new Date('2026-05-27T20:12:00Z'),
      incomingBankMessageId: 'incoming-1',
    });
    prisma.expense.create.mockResolvedValue({ id: 'expense-1' });
    prisma.pendingExpense.update.mockResolvedValue({});

    await expect(service.confirmPendingExpense('pending-1')).resolves.toEqual({ id: 'expense-1' });
    expect(prisma.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        source: 'ios_shortcuts',
        incomingBankMessageId: 'incoming-1',
      }),
      include: { category: true },
    });
    expect(prisma.pendingExpense.update).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
      data: { status: 'confirmed' },
    });
  });

  it('throws when confirming missing pending expense', async () => {
    const { prisma, service } = createService();
    prisma.pendingExpense.findUnique.mockResolvedValue(undefined);

    await expect(service.confirmPendingExpense('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ignores pending expense', async () => {
    const { prisma, service } = createService();
    prisma.pendingExpense.update.mockResolvedValue({ id: 'pending-1', status: 'ignored' });

    await expect(service.ignorePendingExpense('pending-1')).resolves.toMatchObject({ status: 'ignored' });
    expect(prisma.pendingExpense.update).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
      data: { status: 'ignored' },
      include: { category: true },
    });
  });

  it('edits pending expense from text', async () => {
    const { prisma, categories, manualParser, service } = createService();
    prisma.pendingExpense.findUnique.mockResolvedValue({ id: 'pending-1', userId: 'user-1', currency: 'EUR' });
    manualParser.parse.mockReturnValue({ amount: 4.2, currency: 'EUR', merchant: 'COFFEE', description: 'COFFEE' });
    categories.categorizeMerchant.mockResolvedValue({ id: 'cat-coffee' });
    prisma.pendingExpense.update.mockResolvedValue({ id: 'pending-1', status: 'edited' });

    await expect(service.editPendingExpense('pending-1', '4.20 coffee')).resolves.toMatchObject({ status: 'edited' });
    expect(prisma.pendingExpense.update).toHaveBeenCalledWith({
      where: { id: 'pending-1' },
      data: {
        amount: new Prisma.Decimal(4.2),
        currency: 'EUR',
        merchant: 'COFFEE',
        description: 'COFFEE',
        categoryId: 'cat-coffee',
        status: 'edited',
      },
      include: { category: true },
    });
  });

  it('returns pending expense with category', async () => {
    const { prisma, service } = createService();
    prisma.pendingExpense.findUnique.mockResolvedValue({ id: 'pending-1', category });

    await expect(service.getPendingExpense('pending-1')).resolves.toMatchObject({ id: 'pending-1' });
  });

  it('calculates current month stats by category', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-28T12:00:00Z'));
    const { prisma, service } = createService();
    prisma.expense.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal(12.4), categoryId: 'cat-1', category },
      { amount: new Prisma.Decimal(3.6), categoryId: 'cat-1', category },
    ]);

    await expect(service.getCurrentMonthStats('user-1')).resolves.toMatchObject({
      monthName: 'май',
      total: 16,
      expenseCount: 2,
      averageExpense: 8,
      currency: 'EUR',
      byCategory: [{ category: '🛒 Продукты', amount: 16 }],
    });
    expect(prisma.expense.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        transactionDate: {
          gte: expect.any(Date),
          lt: expect.any(Date),
        },
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });
    const range = prisma.expense.findMany.mock.calls[0][0].where.transactionDate;
    expect(dayjs(range.gte).format('YYYY-MM-DD HH:mm:ss')).toBe('2026-05-01 00:00:00');
    expect(dayjs(range.lt).format('YYYY-MM-DD HH:mm:ss')).toBe('2026-06-01 00:00:00');
  });

  it('calculates half-year stats with months, categories, merchants and largest expense', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-28T12:00:00Z'));
    const { prisma, service } = createService();
    prisma.expense.findMany.mockResolvedValue([
      {
        amount: new Prisma.Decimal(30),
        categoryId: 'cat-1',
        category,
        merchant: 'LIDL',
        description: null,
        currency: 'EUR',
        transactionDate: new Date('2026-05-20T10:00:00Z'),
      },
      {
        amount: new Prisma.Decimal(10),
        categoryId: 'cat-1',
        category,
        merchant: 'LIDL',
        description: null,
        currency: 'EUR',
        transactionDate: new Date('2026-04-20T10:00:00Z'),
      },
    ]);

    await expect(service.getHalfYearStats('user-1')).resolves.toMatchObject({
      total: 40,
      expenseCount: 2,
      averagePerMonth: 40 / 6,
      byCategory: [{ category: '🛒 Продукты', amount: 40 }],
      topMerchants: [{ merchant: 'LIDL', amount: 40, count: 2 }],
      largestExpense: { merchant: 'LIDL', amount: 30, currency: 'EUR' },
    });
  });

  it('updates saved expense from text', async () => {
    const { prisma, categories, manualParser, service } = createService();
    prisma.expense.findFirst.mockResolvedValue({ id: 'expense-1', userId: 'user-1', currency: 'EUR' });
    manualParser.parse.mockReturnValue({ amount: 8.9, currency: 'EUR', merchant: 'WOLT', description: 'WOLT' });
    categories.categorizeMerchant.mockResolvedValue({ id: 'cat-food' });
    prisma.expense.update.mockResolvedValue({ id: 'expense-1', merchant: 'WOLT' });

    await expect(service.updateExpenseFromText('expense-1', 'user-1', '8.90 wolt')).resolves.toMatchObject({
      id: 'expense-1',
      merchant: 'WOLT',
    });
    expect(prisma.expense.update).toHaveBeenCalledWith({
      where: { id: 'expense-1' },
      data: {
        amount: new Prisma.Decimal(8.9),
        currency: 'EUR',
        merchant: 'WOLT',
        description: 'WOLT',
        categoryId: 'cat-food',
      },
      include: { category: true },
    });
  });

  it('deletes latest expense', async () => {
    const { prisma, service } = createService();
    prisma.expense.findFirst.mockResolvedValue({ id: 'expense-1', amount: new Prisma.Decimal(12), currency: 'EUR' });
    prisma.expense.delete.mockResolvedValue({});

    await expect(service.deleteLatestExpense('user-1')).resolves.toMatchObject({ id: 'expense-1' });
    expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'expense-1' } });
  });

  it('applies a Mini App edit and merchant rule in one transaction, with an opt-out', async () => {
    const { prisma, service, categories } = createService();
    prisma.expense.findFirst.mockResolvedValue({ id: 'expense-1', userId: 'user-1' });
    prisma.expense.update.mockResolvedValue({ id: 'expense-1' });
    const data = { merchant: 'ZORBAS', amount: new Prisma.Decimal(5), currency: 'EUR', categoryId: 'cat-2', transactionDate: new Date() };
    expect(await service.saveExpenseEdit('expense-1', 'user-1', data, true)).toMatchObject({ affectedExpenses: 4 });
    expect(categories.applyMerchantCategory).toHaveBeenCalledWith(prisma, 'user-1', 'ZORBAS', 'cat-2');
    categories.applyMerchantCategory.mockClear();
    await service.saveExpenseEdit('expense-1', 'user-1', data, false);
    expect(categories.applyMerchantCategory).not.toHaveBeenCalled();
  });

  it('updates expense category', async () => {
    const { prisma, service } = createService();
    prisma.expense.findFirst.mockResolvedValue({ id: 'expense-1', userId: 'user-1' });
    prisma.expense.update.mockResolvedValue({ id: 'expense-1', categoryId: 'cat-2' });

    await expect(service.updateExpenseCategory('expense-1', 'user-1', 'cat-2')).resolves.toMatchObject({
      categoryId: 'cat-2',
    });
  });

  it('searches expenses by merchant or description', async () => {
    const { prisma, service } = createService();
    prisma.expense.findMany.mockResolvedValue([]);

    await service.searchExpenses('user-1', 'lidl');
    expect(prisma.expense.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        OR: [
          { merchant: { contains: 'lidl', mode: 'insensitive' } },
          { description: { contains: 'lidl', mode: 'insensitive' } },
        ],
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
      take: 10,
    });
  });

  it('returns empty search results for blank query without hitting prisma', async () => {
    const { prisma, service } = createService();

    await expect(service.searchExpenses('user-1', '   ')).resolves.toEqual([]);
    expect(prisma.expense.findMany).not.toHaveBeenCalled();
  });

  it('gets expenses for export by period', async () => {
    const { prisma, service } = createService();
    prisma.expense.findMany.mockResolvedValue([]);

    await service.getExpensesForExport('user-1', 'month');
    expect(prisma.expense.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user-1' }),
        include: { category: true },
      }),
    );
  });

  it('formats expense line', () => {
    const { service } = createService();

    expect(
      service.formatExpenseLine({
        merchant: 'LIDL',
        description: null,
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        category,
      } as never),
    ).toBe('LIDL — 12.40 EUR — 🛒 Продукты');
  });
});
