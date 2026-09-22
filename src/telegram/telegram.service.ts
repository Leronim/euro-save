import { ConflictException, NotFoundException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Expense, PendingExpense } from '@prisma/client';
import dayjs from 'dayjs';
import { Context, Markup, Telegraf } from 'telegraf';
import { CategoriesService } from '../categories/categories.service';
import { formatMoney } from '../common/utils/money';
import { ExpensesService } from '../expenses/expenses.service';
import { renderPeriodReport, ReportPeriod, ReportView } from '../expenses/period-report';
import { expenseConfirmationKeyboard } from './telegram-keyboards';

type PendingWithCategory = PendingExpense & { category?: Category | null };
type ExpenseWithCategory = Expense & { category?: Category | null };
type EditState = { type: 'pending' | 'expense'; id: string };

const TODAY_EXPENSES_BUTTON = '📅 Сегодня';
const WEEK_EXPENSES_BUTTON = '📊 Расходы за неделю';
const MONTH_EXPENSES_BUTTON = '🗓 Расходы за месяц';
const HALF_YEAR_EXPENSES_BUTTON = '📈 Расходы за полгода';
const LATEST_EXPENSES_BUTTON = '🧾 Последние расходы';
const UNDO_LAST_EXPENSE_BUTTON = '↩️ Отменить последний';
const SEARCH_EXPENSES_BUTTON = '🔎 Поиск';
const EXPORT_EXPENSES_BUTTON = '📤 Экспорт CSV';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private readonly bot?: Telegraf;
  private readonly editState = new Map<number, EditState>();
  private readonly categoryTokens = new Map<string, { expenseId: string; categoryId: string }>();
  private categoryTokenSeq = 0;
  private dailyReportTimer?: NodeJS.Timeout;
  private lastDailyReportKey?: string;

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

    await this.bot.telegram.setChatMenuButton({ menuButton: { type: 'web_app', text: 'Мои расходы', web_app: { url: this.miniAppUrl() } } }).catch(error => this.logger.warn(`Unable to configure Mini App menu: ${error}`));

    void this.bot
      .launch()
      .then(() => {
        this.logger.log('Telegram bot started');
        this.startDailyReportTimer();
      })
      .catch((error) => {
        this.logger.error('Telegram bot failed to start', error);
      });
  }

  async onModuleDestroy() {
    if (this.dailyReportTimer) {
      clearInterval(this.dailyReportTimer);
    }
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

    this.bot.command('app', async (ctx) => this.openApp(ctx));
    this.bot.command('menu', async (ctx) => this.openApp(ctx));
    this.bot.command('cancel', async (ctx) => this.openApp(ctx));
    this.bot.action(/^report:close$/, async (ctx) => {
      await ctx.answerCbQuery();
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await this.openApp(ctx);
    });

    this.bot.start(async (ctx) => {
      await this.ensureTelegramUser(ctx);
      await this.openApp(ctx);
    });

    this.bot.help(async (ctx) => this.openApp(ctx));

    this.bot.command('categories', async (ctx) => {
      const categories = await this.categories.listExpenseCategories();
      await ctx.reply(categories.map((category) => this.categories.formatCategory(category)).join('\n'));
    });

    this.bot.command('today', async (ctx) => {
      await this.replyTodayStats(ctx);
    });

    this.bot.command('month', async (ctx) => {
      await this.replyCurrentMonthStats(ctx);
    });

    this.bot.command('week', async (ctx) => {
      await this.replyCurrentWeekStats(ctx);
    });

    this.bot.command('halfyear', async (ctx) => {
      await this.replyHalfYearStats(ctx);
    });

    this.bot.command('stats', async (ctx) => {
      await this.replyLatestExpenses(ctx);
    });

    this.bot.command('undo', async (ctx) => {
      await this.undoLatestExpense(ctx);
    });

    this.bot.command('search', async (ctx) => {
      const text = 'text' in ctx.message ? ctx.message.text : '';
      const query = text.replace(/^\/search(@\w+)?\s*/i, '').trim();
      await this.replySearchResults(ctx, query);
    });

    this.bot.command('export', async (ctx) => {
      await this.replyExportOptions(ctx);
    });

    this.bot.action(/^r:(w|m):(\d{8}):(s|c|d|o|u|[a-f0-9-]{36}):(\d{1,5})$/, async (ctx) => {
      const [, period, anchor, view, page] = ctx.match as RegExpExecArray;
      await ctx.answerCbQuery();
      await this.replyPeriodReport(ctx, period as ReportPeriod, anchor, view as ReportView, Number(page));
    });

    this.bot.action(/^expense:confirm:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      const expense = await this.expenses.confirmPendingExpense(id).catch(async error => {
        if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error;
        await ctx.answerCbQuery('Покупка уже обработана. Обновите приложение.');
        return null;
      });
      if (!expense) return;
      await ctx.answerCbQuery('Записано');
      await ctx.reply(await this.formatConfirmedExpenseWithSummary(expense));
    });

    this.bot.action(/^expense:ignore:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      const ignored = await this.expenses.ignorePendingExpense(id).catch(async error => {
        if (!(error instanceof ConflictException || error instanceof NotFoundException)) throw error;
        await ctx.answerCbQuery('Покупка уже обработана. Обновите приложение.');
        return null;
      });
      if (!ignored) return;
      await ctx.answerCbQuery('Игнорировано');
      await this.deleteCallbackMessage(ctx);
      await ctx.reply('Ок, расход проигнорирован.');
    });

    this.bot.action(/^expense:edit:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      this.editState.set(ctx.chat?.id ?? 0, { type: 'pending', id });
      await ctx.answerCbQuery('Редактирование');
      await ctx.reply(['Отправь расход в формате:', '', '12.40 LIDL продукты'].join('\n'));
    });

    this.bot.action(/^expense:delete:(.+)$/, async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const id = (ctx.match as RegExpExecArray)[1];
      const expense = await this.expenses.deleteExpense(id, user.id);
      await ctx.answerCbQuery('Удалено');
      await ctx.reply(`Удалил расход:\n\n${this.expenses.formatExpenseLine(expense)}`, {
        reply_markup: this.mainMenuKeyboard(),
      });
    });

    this.bot.action(/^expense:edit_saved:(.+)$/, async (ctx) => {
      const id = (ctx.match as RegExpExecArray)[1];
      this.editState.set(ctx.chat?.id ?? 0, { type: 'expense', id });
      await ctx.answerCbQuery('Редактирование');
      await ctx.reply(['Отправь новую версию расхода:', '', '12.40 LIDL продукты'].join('\n'));
    });

    this.bot.action(/^expense:categories:(.+)$/, async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const id = (ctx.match as RegExpExecArray)[1];
      await this.expenses.getExpense(id, user.id);
      await ctx.answerCbQuery('Категория');
      await ctx.reply('Выбери категорию:', {
        reply_markup: await this.categoryKeyboard(id),
      });
    });

    this.bot.action(/^expense:export:(month|halfyear)$/, async (ctx) => {
      const period = (ctx.match as RegExpExecArray)[1] as 'month' | 'halfyear';
      await ctx.answerCbQuery('Готовлю CSV');
      await this.sendCsvExport(ctx, period);
    });

    this.bot.action(/^cat:(.+)$/, async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const token = (ctx.match as RegExpExecArray)[1];
      const payload = this.categoryTokens.get(token);
      if (!payload) {
        await ctx.answerCbQuery('Кнопка устарела');
        return;
      }

      const expense = await this.expenses.updateExpenseCategory(payload.expenseId, user.id, payload.categoryId);
      this.categoryTokens.delete(token);
      await ctx.answerCbQuery('Категория обновлена');
      await ctx.reply(`Категория обновлена:\n\n${this.expenses.formatExpenseLine(expense)}`, {
        reply_markup: this.mainMenuKeyboard(),
      });
    });

    this.bot.on('text', async (ctx) => {
      const user = await this.ensureTelegramUser(ctx);
      const text = ctx.message.text;
      const editPendingId = this.editState.get(ctx.chat.id);

      if (text === TODAY_EXPENSES_BUTTON) {
        await this.replyTodayStats(ctx);
        return;
      }

      if (text === WEEK_EXPENSES_BUTTON) {
        await this.replyCurrentWeekStats(ctx);
        return;
      }

      if (text === MONTH_EXPENSES_BUTTON) {
        await this.replyCurrentMonthStats(ctx);
        return;
      }

      if (text === HALF_YEAR_EXPENSES_BUTTON) {
        await this.replyHalfYearStats(ctx);
        return;
      }

      if (text === LATEST_EXPENSES_BUTTON) {
        await this.replyLatestExpenses(ctx);
        return;
      }

      if (text === UNDO_LAST_EXPENSE_BUTTON) {
        await this.undoLatestExpense(ctx);
        return;
      }

      if (text === SEARCH_EXPENSES_BUTTON) {
        await ctx.reply(['Напиши поиск так:', '', '/search lidl'].join('\n'), {
          reply_markup: this.mainMenuKeyboard(),
        });
        return;
      }

      if (text === EXPORT_EXPENSES_BUTTON) {
        await this.replyExportOptions(ctx);
        return;
      }

      if (editPendingId) {
        if (editPendingId.type === 'expense') {
          const expense = await this.expenses.updateExpenseFromText(editPendingId.id, user.id, text);
          this.editState.delete(ctx.chat.id);
          await ctx.reply(`Обновил расход:\n\n${this.expenses.formatExpenseLine(expense)}`, {
            reply_markup: await this.expenseActionsKeyboard(expense.id),
          });
          await ctx.reply('Можно сразу поменять категорию кнопкой под расходом.', {
            reply_markup: this.mainMenuKeyboard(),
          });
          return;
        }

        const pending = await this.expenses.editPendingExpense(editPendingId.id, text);
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

  private async replyTodayStats(ctx: Context) {
    const user = await this.ensureTelegramUser(ctx);
    const stats = await this.expenses.getTodayStats(user.id);
    const lines = [
      '📅 Расходы за сегодня',
      '',
      `Всего: ${formatMoney(stats.total, stats.currency)}`,
      `Операций: ${stats.expenseCount}`,
      `Средний чек: ${formatMoney(stats.averageExpense, stats.currency)}`,
      '',
      ...(stats.byCategory.length
        ? stats.byCategory.map((row) => `${row.category}: ${formatMoney(row.amount, stats.currency)}`)
        : ['Нет расходов']),
    ];

    await ctx.reply(lines.join('\n'), {
      reply_markup: this.mainMenuKeyboard(),
    });
  }

  private async replyCurrentWeekStats(ctx: Context) {
    await this.replyPeriodReport(ctx, 'w');
  }

  private async replyCurrentMonthStats(ctx: Context) {
    await this.replyPeriodReport(ctx, 'm');
  }

  private async replyPeriodReport(ctx: Context, period: ReportPeriod, anchor?: string, view: ReportView = 's', page = 0) {
    const user = await this.ensureTelegramUser(ctx);
    const report = await this.expenses.getPeriodReport(user.id, period, anchor);
    const message = renderPeriodReport(report, view, page);
    if (ctx.callbackQuery) {
      try {
        await ctx.editMessageText(message.text, { reply_markup: message.reply_markup });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('message is not modified')) throw error;
      }
    } else {
      await ctx.reply(message.text, { reply_markup: message.reply_markup });
    }
  }

  private async replyHalfYearStats(ctx: Context) {
    const user = await this.ensureTelegramUser(ctx);
    const stats = await this.expenses.getHalfYearStats(user.id);
    const startLabel = dayjs(stats.start).format('DD.MM.YYYY');
    const endLabel = dayjs(stats.end).format('DD.MM.YYYY');
    const lines = [
      '📈 Расходы за полгода',
      `Период: ${startLabel}–${endLabel}`,
      '',
      `Всего: ${formatMoney(stats.total, stats.currency)}`,
      `Операций: ${stats.expenseCount}`,
      `Среднее в месяц: ${formatMoney(stats.averagePerMonth, stats.currency)}`,
      '',
      'По месяцам:',
      ...stats.byMonth.map((row) => `${row.label}: ${formatMoney(row.amount, stats.currency)}`),
      '',
      'По категориям:',
      ...(stats.byCategory.length
        ? stats.byCategory.map((row) => `${row.category}: ${formatMoney(row.amount, stats.currency)}`)
        : ['Нет расходов']),
      '',
      'Топ магазинов:',
      ...(stats.topMerchants.length
        ? stats.topMerchants.map(
            (row, index) => `${index + 1}. ${row.merchant}: ${formatMoney(row.amount, stats.currency)} (${row.count})`,
          )
        : ['Нет расходов']),
    ];

    if (stats.largestExpense) {
      lines.push(
        '',
        'Самый крупный расход:',
        `${stats.largestExpense.merchant} — ${formatMoney(
          stats.largestExpense.amount,
          stats.largestExpense.currency,
        )} — ${dayjs(stats.largestExpense.date).format('DD.MM.YYYY')}`,
      );
    }

    await ctx.reply(lines.join('\n'), {
      reply_markup: this.mainMenuKeyboard(),
    });
  }

  private async replyLatestExpenses(ctx: Context) {
    const user = await this.ensureTelegramUser(ctx);
    const latest = await this.expenses.getLatestExpenses(user.id);
    if (!latest.length) {
      await ctx.reply('Расходов пока нет.', {
        reply_markup: this.mainMenuKeyboard(),
      });
      return;
    }

    const lines = ['Последние расходы:', ''];
    latest.forEach((expense, index) => {
      lines.push(this.expenses.formatExpenseLine(expense, index + 1));
    });

    await ctx.reply(lines.join('\n'), {
      reply_markup: this.latestExpensesKeyboard(latest),
    });
  }

  private async replySearchResults(ctx: Context, query: string) {
    if (!query) {
      await ctx.reply(['Напиши поиск так:', '', '/search lidl'].join('\n'), {
        reply_markup: this.mainMenuKeyboard(),
      });
      return;
    }

    const user = await this.ensureTelegramUser(ctx);
    const results = await this.expenses.searchExpenses(user.id, query);
    if (!results.length) {
      await ctx.reply(`Ничего не нашел по запросу: ${query}`, {
        reply_markup: this.mainMenuKeyboard(),
      });
      return;
    }

    const lines = [`Поиск: ${query}`, ''];
    results.forEach((expense, index) => {
      lines.push(this.expenses.formatExpenseLine(expense, index + 1));
    });
    await ctx.reply(lines.join('\n'), {
      reply_markup: this.latestExpensesKeyboard(results),
    });
  }

  private async undoLatestExpense(ctx: Context) {
    const user = await this.ensureTelegramUser(ctx);
    try {
      const expense = await this.expenses.deleteLatestExpense(user.id);
      await ctx.reply(`Отменил последний расход:\n\n${this.expenses.formatExpenseLine(expense)}`, {
        reply_markup: this.mainMenuKeyboard(),
      });
    } catch {
      await ctx.reply('Расходов для отмены пока нет.', {
        reply_markup: this.mainMenuKeyboard(),
      });
    }
  }

  private async replyExportOptions(ctx: Context) {
    await ctx.reply('Что экспортировать?', {
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('Текущий месяц', 'expense:export:month')],
        [Markup.button.callback('Полгода', 'expense:export:halfyear')],
      ]).reply_markup,
    });
  }

  private async sendCsvExport(ctx: Context, period: 'month' | 'halfyear') {
    const user = await this.ensureTelegramUser(ctx);
    const expenses = await this.expenses.getExpensesForExport(user.id, period);
    const csv = this.buildExpensesCsv(expenses);
    const filename = `expenses-${period}-${dayjs().format('YYYY-MM-DD')}.csv`;
    await ctx.replyWithDocument({
      source: Buffer.from(csv, 'utf8'),
      filename,
    });
  }

  private buildExpensesCsv(expenses: ExpenseWithCategory[]) {
    const header = ['date', 'merchant', 'description', 'amount', 'currency', 'category', 'source'];
    const rows = expenses.map((expense) => [
      dayjs(expense.transactionDate).format('YYYY-MM-DD HH:mm:ss'),
      expense.merchant ?? '',
      expense.description ?? '',
      Number(expense.amount).toFixed(2),
      expense.currency,
      this.categories.formatCategory(expense.category),
      expense.source,
    ]);

    return [header, ...rows].map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\n');
  }

  private csvCell(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private latestExpensesKeyboard(expenses: ExpenseWithCategory[]) {
    return Markup.inlineKeyboard(
      expenses.slice(0, 5).flatMap((expense, index) => [
        [
          Markup.button.callback(`✏️ ${index + 1}`, `expense:edit_saved:${expense.id}`),
          Markup.button.callback(`🏷 ${index + 1}`, `expense:categories:${expense.id}`),
          Markup.button.callback(`↩️ ${index + 1}`, `expense:delete:${expense.id}`),
        ],
      ]),
    ).reply_markup;
  }

  private async expenseActionsKeyboard(expenseId: string) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('🏷 Категория', `expense:categories:${expenseId}`),
        Markup.button.callback('↩️ Удалить', `expense:delete:${expenseId}`),
      ],
    ]).reply_markup;
  }

  private async categoryKeyboard(expenseId: string) {
    const categories = await this.categories.listExpenseCategories();
    const rows = categories.map((category) => {
      const token = this.nextCategoryToken(expenseId, category.id);
      return [Markup.button.callback(this.categories.formatCategory(category), `cat:${token}`)];
    });

    return Markup.inlineKeyboard(rows).reply_markup;
  }

  private nextCategoryToken(expenseId: string, categoryId: string) {
    this.categoryTokenSeq += 1;
    const token = String(this.categoryTokenSeq);
    this.categoryTokens.set(token, { expenseId, categoryId });
    return token;
  }

  private miniAppUrl() {
    return this.config.get<string>('MINI_APP_URL', 'https://46.225.185.193.sslip.io/mini-app');
  }

  private mainMenuKeyboard() {
    return { remove_keyboard: true as const };
  }

  private async openApp(ctx: Context) {
    this.editState.delete(ctx.chat?.id ?? 0);
    await ctx.reply('Привет! Расходы, графики и категории теперь в приложении. Здесь можно отправлять покупки и подтверждать SMS.', {
      reply_markup: this.mainMenuKeyboard(),
    });
    await ctx.reply('Откройте «Мои расходы». Закрыть приложение и вернуться в чат можно в любой момент.', {
      reply_markup: { inline_keyboard: [[{ text: '📊 Мои расходы', web_app: { url: this.miniAppUrl() } }]] },
    });
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

  private async formatConfirmedExpenseWithSummary(expense: ExpenseWithCategory): Promise<string> {
    const today = await this.expenses.getTodayStats(expense.userId);
    const week = await this.expenses.getCurrentWeekStats(expense.userId);
    return [
      this.formatConfirmedExpense(expense),
      '',
      `Сегодня потрачено: ${formatMoney(today.total, today.currency)}`,
      `За неделю: ${formatMoney(week.total, week.currency)}`,
    ].join('\n');
  }

  private startDailyReportTimer() {
    if (!this.bot || this.dailyReportTimer) return;

    this.dailyReportTimer = setInterval(() => {
      void this.sendDailyReportIfDue();
    }, 60_000);
    void this.sendDailyReportIfDue();
  }

  private async sendDailyReportIfDue() {
    if (!this.bot) return;

    const ownerId = this.config.get<string>('TELEGRAM_OWNER_ID');
    if (!ownerId) return;

    const now = this.getNicosiaDateParts();
    if (now.hour !== '22' || now.minute !== '00') return;
    if (this.lastDailyReportKey === now.date) return;

    const user = await this.expenses.getOrCreateOwnerUser();
    const today = await this.expenses.getTodayStats(user.id);
    const week = await this.expenses.getCurrentWeekStats(user.id);
    this.lastDailyReportKey = now.date;

    await this.bot.telegram.sendMessage(
      ownerId,
      [
        '🌙 Вечерний отчет',
        '',
        `Сегодня: ${formatMoney(today.total, today.currency)}`,
        `Операций сегодня: ${today.expenseCount}`,
        `За неделю: ${formatMoney(week.total, week.currency)}`,
      ].join('\n'),
    );
  }

  private getNicosiaDateParts() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.config.get<string>('DEFAULT_TIMEZONE', 'Europe/Nicosia'),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((part) => [part.type, part.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: parts.hour,
      minute: parts.minute,
    };
  }
}
