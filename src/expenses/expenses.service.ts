import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExpenseSource, PendingExpense, Prisma, User } from '@prisma/client';
import dayjs from 'dayjs';
import 'dayjs/locale/ru';
import { CategoriesService } from '../categories/categories.service';
import { monthRange } from '../common/utils/date';
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

  async getCurrentMonthStats(userId: string) {
    const { start, end } = monthRange();
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
      monthName: dayjs().locale('ru').format('MMMM'),
      total,
      currency: this.config.get<string>('DEFAULT_CURRENCY', 'EUR'),
      byCategory: [...byCategory.values()],
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
}
