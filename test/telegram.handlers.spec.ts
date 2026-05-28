const handlers: {
  start?: (ctx: any) => Promise<void>;
  help?: (ctx: any) => Promise<void>;
  commands: Record<string, (ctx: any) => Promise<void>>;
  actions: Array<{ pattern: RegExp; handler: (ctx: any) => Promise<void> }>;
  onText?: (ctx: any) => Promise<void>;
} = {
  commands: {},
  actions: [],
};

const telegrafInstances: any[] = [];

jest.mock('telegraf', () => {
  class Telegraf {
    telegram = { sendMessage: jest.fn() };
    launch = jest.fn(() => Promise.resolve());
    stop = jest.fn();

    constructor(public readonly token: string) {
      telegrafInstances.push(this);
    }

    start(handler: (ctx: any) => Promise<void>) {
      handlers.start = handler;
    }

    help(handler: (ctx: any) => Promise<void>) {
      handlers.help = handler;
    }

    command(name: string, handler: (ctx: any) => Promise<void>) {
      handlers.commands[name] = handler;
    }

    action(pattern: RegExp, handler: (ctx: any) => Promise<void>) {
      handlers.actions.push({ pattern, handler });
    }

    on(event: string, handler: (ctx: any) => Promise<void>) {
      if (event === 'text') handlers.onText = handler;
    }
  }

  return {
    Telegraf,
    Markup: {
      button: {
        callback: (text: string, callback_data: string) => ({ text, callback_data }),
      },
      inlineKeyboard: (inline_keyboard: unknown) => ({ reply_markup: { inline_keyboard } }),
    },
  };
});

import { Prisma } from '@prisma/client';
import { TelegramService } from '../src/telegram/telegram.service';

describe('TelegramService handlers', () => {
  const createService = () => {
    handlers.commands = {};
    handlers.actions = [];
    handlers.start = undefined;
    handlers.help = undefined;
    handlers.onText = undefined;
    telegrafInstances.length = 0;

    const config = {
      get: jest.fn((key: string, fallback?: string) => {
        const values: Record<string, string> = {
          TELEGRAM_BOT_TOKEN: 'token',
          TELEGRAM_OWNER_ID: '451204875',
          DEFAULT_TIMEZONE: 'Europe/Nicosia',
        };
        return values[key] ?? fallback;
      }),
    };
    const expenses = {
      getOrCreateOwnerUser: jest.fn().mockResolvedValue({ id: 'user-1' }),
      getTodayStats: jest.fn().mockResolvedValue({
        total: 12.4,
        currency: 'EUR',
        expenseCount: 1,
        averageExpense: 12.4,
        byCategory: [{ category: '🛒 Продукты', amount: 12.4 }],
      }),
      getCurrentWeekStats: jest.fn().mockResolvedValue({
        start: new Date('2026-05-25T00:00:00Z'),
        end: new Date('2026-05-31T00:00:00Z'),
        total: 20,
        currency: 'EUR',
        byCategory: [],
      }),
      getCurrentMonthStats: jest.fn().mockResolvedValue({
        monthName: 'май',
        total: 50,
        currency: 'EUR',
        expenseCount: 3,
        averageExpense: 16.67,
        byCategory: [],
      }),
      getHalfYearStats: jest.fn().mockResolvedValue({
        start: new Date('2025-12-01T00:00:00Z'),
        end: new Date('2026-05-31T00:00:00Z'),
        total: 120,
        currency: 'EUR',
        expenseCount: 10,
        averagePerMonth: 20,
        byMonth: [],
        byCategory: [],
        topMerchants: [],
      }),
      getLatestExpenses: jest.fn().mockResolvedValue([
        { id: 'expense-1', merchant: 'LIDL', amount: new Prisma.Decimal(12.4), currency: 'EUR' },
      ]),
      createPendingManualExpense: jest.fn().mockResolvedValue({ id: 'pending-1' }),
      getPendingExpense: jest.fn().mockResolvedValue({
        id: 'pending-1',
        merchant: 'LIDL',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        category: { emoji: '🛒', name: 'Продукты' },
      }),
      confirmPendingExpense: jest.fn().mockResolvedValue({
        userId: 'user-1',
        merchant: 'LIDL',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
        category: { emoji: '🛒', name: 'Продукты' },
      }),
      ignorePendingExpense: jest.fn().mockResolvedValue({}),
      editPendingExpense: jest.fn().mockResolvedValue({
        id: 'pending-1',
        merchant: 'WOLT',
        amount: new Prisma.Decimal(8.9),
        currency: 'EUR',
      }),
      deleteExpense: jest.fn().mockResolvedValue({
        merchant: 'LIDL',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
      }),
      getExpense: jest.fn().mockResolvedValue({ id: 'expense-1' }),
      updateExpenseCategory: jest.fn().mockResolvedValue({
        merchant: 'LIDL',
        amount: new Prisma.Decimal(12.4),
        currency: 'EUR',
      }),
      getExpensesForExport: jest.fn().mockResolvedValue([]),
      formatExpenseLine: jest.fn((expense: { merchant?: string; amount: Prisma.Decimal; currency: string }) => {
        return `${expense.merchant ?? 'Расход'} — ${Number(expense.amount).toFixed(2)} ${expense.currency}`;
      }),
    };
    const categories = {
      formatCategory: jest.fn((category?: { emoji?: string; name?: string } | null) =>
        category ? `${category.emoji ?? ''} ${category.name}`.trim() : '❓ Другое',
      ),
      listExpenseCategories: jest.fn().mockResolvedValue([{ id: 'cat-1', emoji: '🛒', name: 'Продукты' }]),
    };

    return {
      service: new TelegramService(config as never, expenses as never, categories as never),
      expenses,
      categories,
    };
  };

  const textCtx = (text: string) => ({
    from: { id: 1, username: 'nikita', first_name: 'Nikita' },
    chat: { id: 1 },
    message: { text },
    reply: jest.fn(),
  });

  const actionCtx = (callbackData: string) => {
    const action = handlers.actions.find((item) => item.pattern.test(callbackData));
    if (!action) throw new Error(`No action handler for ${callbackData}`);
    const match = action.pattern.exec(callbackData);
    return {
      action,
      ctx: {
        match,
        from: { id: 1 },
        chat: { id: 1 },
        callbackQuery: { message: { message_id: 10 } },
        answerCbQuery: jest.fn(),
        deleteMessage: jest.fn(),
        reply: jest.fn(),
        replyWithDocument: jest.fn(),
      },
    };
  };

  it('registers commands and starts bot', async () => {
    const { service } = createService();

    await service.onModuleInit();
    expect(telegrafInstances[0].launch).toHaveBeenCalled();
    expect(Object.keys(handlers.commands)).toEqual(
      expect.arrayContaining(['today', 'week', 'month', 'halfyear', 'stats', 'undo', 'search', 'export']),
    );
    await service.onModuleDestroy();
  });

  it('handles start and main menu text buttons', async () => {
    createService();
    const ctx = textCtx('📅 Сегодня');

    await handlers.start?.(ctx);
    await handlers.onText?.(ctx);

    expect(ctx.reply.mock.calls[0][0]).toContain('Привет');
    expect(ctx.reply.mock.calls[1][0]).toContain('Расходы за сегодня');
  });

  it('handles manual expense text', async () => {
    const { expenses } = createService();
    const ctx = textCtx('12.40 lidl');

    await handlers.onText?.(ctx);

    expect(expenses.createPendingManualExpense).toHaveBeenCalled();
    expect(ctx.reply.mock.calls[0][0]).toContain('Найден расход');
  });

  it('handles confirm, ignore and edit pending callbacks', async () => {
    createService();
    const confirm = actionCtx('expense:confirm:pending-1');
    await confirm.action.handler(confirm.ctx);
    expect(confirm.ctx.reply.mock.calls[0][0]).toContain('Расход записан');

    const ignore = actionCtx('expense:ignore:pending-1');
    await ignore.action.handler(ignore.ctx);
    expect(ignore.ctx.deleteMessage).toHaveBeenCalledWith(10);

    const edit = actionCtx('expense:edit:pending-1');
    await edit.action.handler(edit.ctx);
    expect(edit.ctx.reply.mock.calls[0][0]).toContain('Отправь расход');
  });

  it('handles export and category callbacks', async () => {
    const { expenses } = createService();
    const categories = actionCtx('expense:categories:expense-1');
    await categories.action.handler(categories.ctx);
    expect(categories.ctx.reply.mock.calls[0][0]).toContain('Выбери категорию');

    const token = categories.ctx.reply.mock.calls[0][1].reply_markup.inline_keyboard[0][0].callback_data.replace('cat:', '');
    const category = actionCtx(`cat:${token}`);
    await category.action.handler(category.ctx);
    expect(expenses.updateExpenseCategory).toHaveBeenCalledWith('expense-1', 'user-1', 'cat-1');

    const exportAction = actionCtx('expense:export:month');
    await exportAction.action.handler(exportAction.ctx);
    expect(exportAction.ctx.replyWithDocument).toHaveBeenCalled();
  });
});
