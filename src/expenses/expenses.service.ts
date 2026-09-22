import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Category, Expense, ExpenseSource, PendingExpense, Prisma, User } from '@prisma/client';
import dayjs from 'dayjs';
import { reportRange, ReportPeriod } from './period-report';
import 'dayjs/locale/ru';
import { CategoriesService } from '../categories/categories.service';
import { dayRange, halfYearRange, monthRange, weekRange } from '../common/utils/date';
import { formatMoney } from '../common/utils/money';
import { ManualExpenseParserService } from '../parser/manual-expense-parser.service';
import { ParsedBankMessage } from '../parser/parsed-bank-message';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly categories: CategoriesService,
    private readonly manualParser: ManualExpenseParserService,
  ) {}

  async getOrCreateOwnerUser(profile?: { id: number | string; username?: string; firstName?: string }): Promise<User> {
    const telegramId = String(profile?.id ?? this.config.get<string>('TELEGRAM_OWNER_ID'));
    if (!telegramId) {
      throw new BadRequestException('TELEGRAM_OWNER_ID is required for MVP single-user mode');
    }

    const user = await this.prisma.user.upsert({
      where: { telegramId },
      update: {
        username: profile?.username,
        firstName: profile?.firstName,
      },
      create: {
        telegramId,
        username: profile?.username,
        firstName: profile?.firstName,
        defaultCurrency: this.config.get<string>('DEFAULT_CURRENCY', 'EUR'),
        timezone: this.config.get<string>('DEFAULT_TIMEZONE', 'Europe/Nicosia'),
      },
    });

    await this.categories.ensureDefaultMerchantRules(user.id);
    return user;
  }

  async createPendingFromParsed(input: {
    userId: string;
    incomingBankMessageId?: string;
    parsed: ParsedBankMessage;
    sourceDate?: Date;
  }): Promise<PendingExpense> {
    if (!input.parsed.amount || !input.parsed.currency) {
      throw new BadRequestException('Unable to parse amount');
    }

    const category = await this.categories.categorizeMerchant(input.userId, input.parsed.merchant);

    return this.prisma.pendingExpense.create({
      data: {
        userId: input.userId,
        incomingBankMessageId: input.incomingBankMessageId,
        amount: new Prisma.Decimal(input.parsed.amount),
        currency: input.parsed.currency,
        merchant: input.parsed.merchant,
        description: input.parsed.description,
        categoryId: category.id,
        transactionDate: input.parsed.transactionDate ?? input.sourceDate ?? new Date(),
      },
    });
  }

  async createPendingManualExpense(user: User, text: string): Promise<PendingExpense | undefined> {
    const parsed = this.manualParser.parse(text, user.defaultCurrency);
    if (!parsed) return undefined;

    return this.createPendingFromParsed({
      userId: user.id,
      parsed: {
        ...parsed,
        type: 'expense',
      },
      sourceDate: new Date(),
    });
  }

  async confirmPendingExpense(id: string) {
    const pending = await this.prisma.pendingExpense.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!pending) throw new NotFoundException('Pending expense not found');

    const expense = await this.prisma.expense.create({
      data: {
        userId: pending.userId,
        amount: pending.amount,
        currency: pending.currency,
        merchant: pending.merchant,
        description: pending.description,
        categoryId: pending.categoryId,
        transactionDate: pending.transactionDate ?? new Date(),
        source: pending.incomingBankMessageId ? ExpenseSource.ios_shortcuts : ExpenseSource.manual,
        incomingBankMessageId: pending.incomingBankMessageId,
      },
      include: { category: true },
    });

    await this.prisma.pendingExpense.update({
      where: { id },
      data: { status: 'confirmed' },
    });

    return expense;
  }

  async ignorePendingExpense(id: string) {
    return this.prisma.pendingExpense.update({
      where: { id },
      data: { status: 'ignored' },
      include: { category: true },
    });
  }

  async editPendingExpense(id: string, text: string) {
    const pending = await this.prisma.pendingExpense.findUnique({ where: { id } });
    if (!pending) throw new NotFoundException('Pending expense not found');

    const parsed = this.manualParser.parse(text, pending.currency);
    if (!parsed) throw new BadRequestException('Unable to parse edited expense');

    const category = await this.categories.categorizeMerchant(pending.userId, parsed.merchant);
    return this.prisma.pendingExpense.update({
      where: { id },
      data: {
        amount: new Prisma.Decimal(parsed.amount),
        currency: parsed.currency,
        merchant: parsed.merchant,
        description: parsed.description,
        categoryId: category.id,
        status: 'edited',
      },
      include: { category: true },
    });
  }

  async getPendingExpense(id: string) {
    const pending = await this.prisma.pendingExpense.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!pending) throw new NotFoundException('Pending expense not found');
    return pending;
  }

  async getPeriodReport(userId: string, period: ReportPeriod, anchor?: string) {
    const timezone = this.config.get<string>('DEFAULT_TIMEZONE', 'Europe/Nicosia');
    const range = reportRange(period, anchor, timezone);
    const query = (start: Date, end: Date) => this.prisma.expense.findMany({
      where: { userId, transactionDate: { gte: start, lt: end } },
      include: { category: true },
      orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }],
    });
    const [expenses, previous] = await Promise.all([
      query(range.start, range.cutoff), query(range.previousStart, range.previousCutoff),
    ]);
    return { range, expenses, previous };
  }

  async getCurrentMonthStats(userId: string) {
    const { start, end } = monthRange();
    const stats = await this.getStatsForRange(userId, start, end);

    return {
      ...stats,
      monthName: dayjs().locale('ru').format('MMMM'),
    };
  }

  async getTodayStats(userId: string) {
    const { start, end } = dayRange();
    const stats = await this.getStatsForRange(userId, start, end);

    return {
      ...stats,
      start,
      end: dayjs(end).subtract(1, 'second').toDate(),
    };
  }

  async getCurrentWeekStats(userId: string) {
    const { start, end } = weekRange();
    const stats = await this.getStatsForRange(userId, start, end);

    return {
      ...stats,
      start,
      end: dayjs(end).subtract(1, 'day').toDate(),
    };
  }

  async getHalfYearStats(userId: string) {
    const { start, end } = halfYearRange();
    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        transactionDate: {
          gte: start,
          lt: end,
        },
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });

    const currency = this.config.get<string>('DEFAULT_CURRENCY', 'EUR');
    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const months = new Map<string, { label: string; amount: number }>();
    const byCategory = new Map<string, { category: string; amount: number }>();
    const byMerchant = new Map<string, { merchant: string; amount: number; count: number }>();

    for (let index = 5; index >= 0; index -= 1) {
      const month = dayjs().subtract(index, 'month').startOf('month');
      months.set(month.format('YYYY-MM'), {
        label: month.locale('ru').format('MMMM YYYY'),
        amount: 0,
      });
    }

    for (const expense of expenses) {
      const amount = Number(expense.amount);
      const monthKey = dayjs(expense.transactionDate).format('YYYY-MM');
      const month = months.get(monthKey);
      if (month) {
        month.amount += amount;
      }

      const categoryKey = expense.categoryId ?? 'other';
      const category = byCategory.get(categoryKey) ?? {
        category: this.categories.formatCategory(expense.category),
        amount: 0,
      };
      category.amount += amount;
      byCategory.set(categoryKey, category);

      const merchantName = expense.merchant ?? expense.description ?? 'Без названия';
      const merchantKey = merchantName.toLowerCase();
      const merchant = byMerchant.get(merchantKey) ?? {
        merchant: merchantName,
        amount: 0,
        count: 0,
      };
      merchant.amount += amount;
      merchant.count += 1;
      byMerchant.set(merchantKey, merchant);
    }

    const largestExpense = [...expenses].sort((left, right) => Number(right.amount) - Number(left.amount))[0];

    return {
      start,
      end: dayjs(end).subtract(1, 'day').toDate(),
      total,
      currency,
      expenseCount: expenses.length,
      averagePerMonth: total / 6,
      byMonth: [...months.values()],
      byCategory: [...byCategory.values()].sort((left, right) => right.amount - left.amount),
      topMerchants: [...byMerchant.values()].sort((left, right) => right.amount - left.amount).slice(0, 5),
      largestExpense: largestExpense
        ? {
            merchant: largestExpense.merchant ?? largestExpense.description ?? 'Расход',
            amount: Number(largestExpense.amount),
            currency: largestExpense.currency,
            date: largestExpense.transactionDate,
          }
        : undefined,
    };
  }

  private async getStatsForRange(userId: string, start: Date, end: Date) {
    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        transactionDate: {
          gte: start,
          lt: end,
        },
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });

    const total = expenses.reduce((sum, expense) => sum + Number(expense.amount), 0);
    const byCategory = new Map<string, { category: string; amount: number }>();

    for (const expense of expenses) {
      const key = expense.categoryId ?? 'other';
      const current = byCategory.get(key) ?? {
        category: this.categories.formatCategory(expense.category),
        amount: 0,
      };
      current.amount += Number(expense.amount);
      byCategory.set(key, current);
    }

    return {
      total,
      expenseCount: expenses.length,
      averageExpense: expenses.length ? total / expenses.length : 0,
      currency: this.config.get<string>('DEFAULT_CURRENCY', 'EUR'),
      byCategory: [...byCategory.values()].sort((left, right) => right.amount - left.amount),
    };
  }

  async getLatestExpenses(userId: string, take = 10) {
    return this.prisma.expense.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
      take,
    });
  }

  async getExpense(id: string, userId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: { category: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async deleteExpense(id: string, userId: string) {
    const expense = await this.getExpense(id, userId);
    await this.prisma.expense.delete({ where: { id } });
    return expense;
  }

  async deleteLatestExpense(userId: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { userId },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    await this.prisma.expense.delete({ where: { id: expense.id } });
    return expense;
  }

  async updateExpenseFromText(id: string, userId: string, text: string) {
    const expense = await this.getExpense(id, userId);
    const parsed = this.manualParser.parse(text, expense.currency);
    if (!parsed) throw new BadRequestException('Unable to parse edited expense');

    const category = await this.categories.categorizeMerchant(userId, parsed.merchant);
    return this.prisma.expense.update({
      where: { id },
      data: {
        amount: new Prisma.Decimal(parsed.amount),
        currency: parsed.currency,
        merchant: parsed.merchant,
        description: parsed.description,
        categoryId: category.id,
      },
      include: { category: true },
    });
  }

  async saveExpenseEdit(id: string, userId: string, data: {
    merchant: string; amount: Prisma.Decimal; currency: string; categoryId: string; transactionDate: Date;
  }, applyToMerchant: boolean) {
    await this.getExpense(id, userId);
    return this.prisma.$transaction(async tx => {
      const expense = await tx.expense.update({ where: { id }, data });
      const affectedExpenses = applyToMerchant
        ? await this.categories.applyMerchantCategory(tx, userId, data.merchant, data.categoryId) : 1;
      return { ...expense, affectedExpenses };
    });
  }

  async updateExpenseCategory(id: string, userId: string, categoryId: string) {
    const expense = await this.getExpense(id, userId);
    return this.prisma.$transaction(async tx => {
      if (expense.merchant?.trim()) {
        await this.categories.applyMerchantCategory(tx, userId, expense.merchant, categoryId);
      } else {
        const category = await tx.category.findFirst({ where: { id: categoryId, type: 'expense', OR: [{ userId: null }, { userId }] } });
        if (!category) throw new BadRequestException('Invalid category');
      }
      return tx.expense.update({ where: { id }, data: { categoryId }, include: { category: true } });
    });
  }

  async searchExpenses(userId: string, query: string, take = 10) {
    const normalized = query.trim();
    if (!normalized) return [];

    return this.prisma.expense.findMany({
      where: {
        userId,
        OR: [
          { merchant: { contains: normalized, mode: 'insensitive' } },
          { description: { contains: normalized, mode: 'insensitive' } },
        ],
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
      take,
    });
  }

  async getExpensesForExport(userId: string, period: 'month' | 'halfyear') {
    const { start, end } = period === 'month' ? monthRange() : halfYearRange();
    return this.prisma.expense.findMany({
      where: {
        userId,
        transactionDate: {
          gte: start,
          lt: end,
        },
      },
      include: { category: true },
      orderBy: { transactionDate: 'desc' },
    });
  }

  formatExpenseLine(expense: Expense & { category?: Category | null }, index?: number) {
    const prefix = typeof index === 'number' ? `${index}. ` : '';
    return `${prefix}${expense.merchant ?? expense.description ?? 'Расход'} — ${formatMoney(
      Number(expense.amount),
      expense.currency,
    )} — ${this.categories.formatCategory(expense.category)}`;
  }
}
