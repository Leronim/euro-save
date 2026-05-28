import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Expense, PendingExpense } from '@prisma/client';
import { Context, Telegraf } from 'telegraf';
import { CategoriesService } from '../categories/categories.service';
import { formatMoney } from '../common/utils/money';
import { ExpensesService } from '../expenses/expenses.service';
import { expenseConfirmationKeyboard } from './telegram-keyboards';

type PendingWithCategory = PendingExpense & { category?: Category | null };
type ExpenseWithCategory = Expense & { category?: Category | null };

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot?: Telegraf;
  private readonly editState = new Map<number, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly expenses: ExpensesService,
    private readonly categories: CategoriesService,
  ) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (token) {
      this.bot = new Telegraf(token);
      this.registerHandlers();
    }
  }

  async onModuleInit() {
    if (!this.bot) {
      this.logger.warn('TELEGRAM_BOT_TOKEN is empty. Telegram bot is disabled.');
      return;
    }

    void this.bot
      .launch()
      .then(() => {
        this.logger.log('Telegram bot started');
      })
      .catch((error) => {
        this.logger.error('Telegram bot failed to start', error);
      });
  }

  async onModuleDestroy() {
    this.bot?.stop();
  }

  async sendPendingExpenseConfirmation(pendingExpenseId: string) {
    if (!this.bot) return;

    const ownerId = this.config.get<string>('TELEGRAM_OWNER_ID');
    if (!ownerId) return;

    const pending = await this.expenses.getPendingExpense(pendingExpenseId);
    await this.bot.telegram.sendMessage(ownerId, this.formatPendingExpense(pending), {
      reply_markup: expenseConfirmationKeyboard(pending.id),
    });
  }

  async sendPossibleNonExpenseMessage(text: string, reason: string) {
    if (!this.bot) return;

    const ownerId = this.config.get<string>('TELEGRAM_OWNER_ID');
    if (!ownerId) return;

    await this.bot.telegram.sendMessage(ownerId, `Возможно, это не расход: ${reason}\n\n${text}`);
  }

  private registerHandlers() {
    if (!this.bot) return;

    this.bot.start(async (ctx) => {
      await this.ensureTelegramUser(ctx);
      await ctx.reply(
        [
          'Привет! Я буду помогать отслеживать расходы.',
          '',
          'Можно отправлять расходы вручную:',
          '12.50 lidl',
          '',
          'Или подключить iPhone Shortcuts для автоматического импорта банковских SMS.',
        ].join('\n'),
      );
    });

    this.bot.help((ctx) => ctx.reply('Команды: /start, /help, /categories, /month, /stats'));

    this.bot.command('categories', async (ctx) => {
      const categories = await this.categories.listExpenseCategories();
      await ctx.reply(categories.map((category) => this.categories.formatCategory(category)).join('\n'));
    });

    this.bot.command('month', async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const stats = await this.expenses.getCurrentMonthStats(user.id);
      const lines = [
        `📊 Расходы за ${stats.monthName}`,
        '',
        `Всего: ${formatMoney(stats.total, stats.currency)}`,
        '',
        ...stats.byCategory.map((row) => `${row.category}: ${formatMoney(row.amount, stats.currency)}`),
      ];
      await ctx.reply(lines.join('\n'));
    });

    this.bot.command('stats', async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const latest = await this.expenses.getLatestExpenses(user.id);
      const lines = ['Последние расходы:', ''];
      latest.forEach((expense, index) => {
        lines.push(
          `${index + 1}. ${expense.merchant ?? expense.description ?? 'Расход'} — ${formatMoney(
            Number(expense.amount),
            expense.currency,
          )} — ${this.categories.formatCategory(expense.category)}`,
        );
      });
      await ctx.reply(lines.join('\n'));
    });

    this.bot.action(/^expense:confirm:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      const expense = await this.expenses.confirmPendingExpense(id);
      await ctx.answerCbQuery('Записано');
      await ctx.reply(this.formatConfirmedExpense(expense));
    });

    this.bot.action(/^expense:ignore:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      await this.expenses.ignorePendingExpense(id);
      await ctx.answerCbQuery('Игнорировано');
      await this.deleteCallbackMessage(ctx);
      await ctx.reply('Ок, расход проигнорирован.');
    });

    this.bot.action(/^expense:edit:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      this.editState.set(ctx.chat?.id ?? 0, id);
      await ctx.answerCbQuery('Редактирование');
      await ctx.reply(['Отправь расход в формате:', '', '12.40 LIDL продукты'].join('\n'));
    });

    this.bot.on('text', async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const text = ctx.message.text;
      const editPendingId = this.editState.get(ctx.chat.id);

      if (editPendingId) {
        const pending = await this.expenses.editPendingExpense(editPendingId, text);
        this.editState.delete(ctx.chat.id);
        await ctx.reply(this.formatPendingExpense(pending), {
          reply_markup: expenseConfirmationKeyboard(pending.id),
        });
        return;
      }

      const pending = await this.expenses.createPendingManualExpense(user, text);
      if (!pending) {
        await ctx.reply('Не смог распознать расход. Пример: 12.50 lidl');
        return;
      }

      const pendingWithCategory = await this.expenses.getPendingExpense(pending.id);
      await ctx.reply(this.formatPendingExpense(pendingWithCategory), {
        reply_markup: expenseConfirmationKeyboard(pending.id),
      });
    });
  }

  private async ensureTelegramUser(ctx: Context) {
    const from = ctx.from;
    return this.expenses.getOrCreateOwnerUser(
      from
        ? {
            id: from.id,
            username: from.username,
            firstName: from.first_name,
          }
        : undefined,
    );
  }

  private async deleteCallbackMessage(ctx: Context) {
    if (!ctx.callbackQuery || !('message' in ctx.callbackQuery) || !ctx.callbackQuery.message) {
      return;
    }

    try {
      await ctx.deleteMessage(ctx.callbackQuery.message.message_id);
    } catch (error) {
      this.logger.warn(`Unable to delete ignored expense message: ${error}`);
    }
  }

  private formatPendingExpense(pending: PendingWithCategory): string {
    return [
      '💸 Найден расход',
      '',
      `Магазин: ${pending.merchant ?? pending.description ?? 'Не указан'}`,
      `Сумма: ${formatMoney(Number(pending.amount), pending.currency)}`,
      `Категория: ${this.categories.formatCategory(pending.category)}`,
      '',
      'Записать?',
    ].join('\n');
  }

  private formatConfirmedExpense(expense: ExpenseWithCategory): string {
    return [
      '✅ Расход записан',
      '',
      `${expense.merchant ?? expense.description ?? 'Расход'} — ${formatMoney(Number(expense.amount), expense.currency)}`,
      `Категория: ${this.categories.formatCategory(expense.category)}`,
    ].join('\n');
  }
}
