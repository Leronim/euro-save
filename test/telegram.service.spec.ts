import { Prisma } from '@prisma/client';
import { TelegramService } from '../src/telegram/telegram.service';

describe('TelegramService helpers', () => {
  const createService = () => {
    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          DEFAULT_TIMEZONE: 'Europe/Nicosia',
          TELEGRAM_OWNER_ID: '451204875',
        };
        return values[key] ?? fallback;
      }),
    };
    const expenses = {
      getTodayStats: jest.fn(),
      getCurrentWeekStats: jest.fn(),
      getOrCreateOwnerUser: jest.fn(),
      getCurrentMonthStats: jest.fn(),
      getHalfYearStats: jest.fn(),
      getLatestExpenses: jest.fn(),
      searchExpenses: jest.fn(),
      deleteLatestExpense: jest.fn(),
      getExpensesForExport: jest.fn(),
      formatExpenseLine: jest.fn((expense: { merchant?: string; amount: Prisma.Decimal; currency: string }, index?: number) => {
        const prefix = typeof index === 'number' ? `${index}. ` : '';
        return `${prefix}${expense.merchant ?? 'Расход'} — ${Number(expense.amount).toFixed(2)} ${expense.currency}`;
      }),
    };
    const categories = {
      formatCategory: jest.fn((category?: { emoji?: string; name?: string } | null) =>
        category ? `${category.emoji ?? ''} ${category.name}`.trim() : '❓ Другое',
      ),
      listExpenseCategories: jest.fn(),
    };

    return {
      config,
      expenses,
      categories,
      service: new TelegramService(config as never, expenses as never, categories as never),
    };
  };

  it('builds CSV export with escaped cells', () => {
    const { service } = createService();
    const csv = (service as never as { buildExpensesCsv: (expenses: unknown[]) => string }).buildExpensesCsv([
      {
        transactionDate: new Date('2026-05-27T20:12:00Z'),
        merchant: 'LIDL "Mall"',
        description: '',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        category: { emoji: '🛒', name: 'Продукты' },
        source: 'manual',
      },
    ]);

    expect(csv).toContain('"LIDL ""Mall"""');
    expect(csv).toContain('"12.40"');
    expect(csv).toContain('"🛒 Продукты"');
  });

  it('builds main menu keyboard', () => {
    const { service } = createService();

    expect((service as never as { mainMenuKeyboard: () => { keyboard: { text: string }[][] } }).mainMenuKeyboard().keyboard).toEqual([
      [{ text: '📅 Сегодня' }, { text: '📊 Расходы за неделю' }],
      [{ text: '🗓 Расходы за месяц' }, { text: '📈 Расходы за полгода' }],
      [{ text: '🧾 Последние расходы' }, { text: '↩️ Отменить последний' }],
      [{ text: '🔎 Поиск' }, { text: '📤 Экспорт CSV' }],
    ]);
  });

  it('formats pending expense confirmation text', () => {
    const { service } = createService();

    expect(
      (service as never as { formatPendingExpense: (expense: unknown) => string }).formatPendingExpense({
        merchant: 'LIDL',
        description: null,
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        category: { emoji: '🛒', name: 'Продукты' },
      }),
    ).toContain('Магазин: LIDL');
  });

  it('adds daily and weekly totals to confirmed expense message', async () => {
    const { expenses, service } = createService();
    expenses.getTodayStats.mockResolvedValue({ total: 20, currency: 'EUR' });
    expenses.getCurrentWeekStats.mockResolvedValue({ total: 80, currency: 'EUR' });

    await expect(
      (service as never as { formatConfirmedExpenseWithSummary: (expense: unknown) => Promise<string> })
        .formatConfirmedExpenseWithSummary({
          userId: 'user-1',
          merchant: 'LIDL',
          description: null,
          amount: new Prisma.Decimal(12.4),
          currency: 'EUR',
          category: { emoji: '🛒', name: 'Продукты' },
        }),
    ).resolves.toContain('Сегодня потрачено: 20.00 EUR');
  });

  it('extracts configured timezone date parts for daily report scheduling', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-05-28T19:00:00Z'));
    const { service } = createService();

    expect((service as never as { getNicosiaDateParts: () => unknown }).getNicosiaDateParts()).toMatchObject({
      date: '2026-05-28',
      hour: '22',
      minute: '00',
    });
    jest.useRealTimers();
  });

  it('replies with today stats', async () => {
    const { expenses, service } = createService();
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    expenses.getTodayStats.mockResolvedValue({
      total: 12.4,
      currency: 'EUR',
      expenseCount: 1,
      averageExpense: 12.4,
      byCategory: [{ category: '🛒 Продукты', amount: 12.4 }],
    });
    const ctx = { from: { id: 1 }, reply: jest.fn() };

    await (service as never as { replyTodayStats: (ctx: unknown) => Promise<void> }).replyTodayStats(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain('Расходы за сегодня');
    expect(ctx.reply.mock.calls[0][0]).toContain('12.40 EUR');
  });

  it('replies with latest expenses and action keyboard', async () => {
    const { expenses, service } = createService();
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    expenses.getLatestExpenses.mockResolvedValue([
      { id: 'expense-1', merchant: 'LIDL', amount: new Prisma.Decimal(12.4), currency: 'EUR' },
    ]);
    const ctx = { from: { id: 1 }, reply: jest.fn() };

    await (service as never as { replyLatestExpenses: (ctx: unknown) => Promise<void> }).replyLatestExpenses(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain('Последние расходы');
    expect(ctx.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].callback_data).toBe('expense:edit_saved:expense-1');
  });

  it('replies with search hint when query is empty', async () => {
    const { service } = createService();
    const ctx = { reply: jest.fn() };

    await (service as never as { replySearchResults: (ctx: unknown, query: string) => Promise<void> }).replySearchResults(ctx, '');

    expect(ctx.reply.mock.calls[0][0]).toContain('/search lidl');
  });

  it('undoes latest expense', async () => {
    const { expenses, service } = createService();
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    expenses.deleteLatestExpense.mockResolvedValue({
      merchant: 'LIDL',
      amount: new Prisma.Decimal(12.4),
      currency: 'EUR',
    });
    const ctx = { from: { id: 1 }, reply: jest.fn() };

    await (service as never as { undoLatestExpense: (ctx: unknown) => Promise<void> }).undoLatestExpense(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain('Отменил последний расход');
  });

  it('sends CSV export as document', async () => {
    const { expenses, service } = createService();
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    expenses.getExpensesForExport.mockResolvedValue([]);
    const ctx = { from: { id: 1 }, replyWithDocument: jest.fn() };

    await (service as never as { sendCsvExport: (ctx: unknown, period: 'month') => Promise<void> }).sendCsvExport(ctx, 'month');

    expect(ctx.replyWithDocument.mock.calls[0][0].filename).toContain('expenses-month');
  });
});
