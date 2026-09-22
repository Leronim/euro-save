import dayjs from 'dayjs';
import { Type } from 'class-transformer';
import { salaryCycle, salaryResult } from './salary-calculator';
import { historyQuery } from './history-query';
import { CategoriesService } from '../categories/categories.service';
import { merchantKey } from '../categories/merchant-key';
import { resolvePending } from '../expenses/pending-actions';
import { UndoService } from './undo.service';
import { BadRequestException, Body, Controller, Delete, NotFoundException, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, ArrayMaxSize, ValidateNested, IsInt, IsIn, IsBoolean, IsOptional, IsDateString, IsNumber, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { ExpensesService } from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramAuthGuard } from './telegram-auth.guard';

export class ExpenseInput {
  @IsOptional() @IsBoolean() applyToMerchant?: boolean;
  @IsString() @Length(1, 120) merchant!: string;
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false }) @Min(0.01) @Max(9999999999.99) amount!: number;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsUUID() categoryId!: string;
  @IsDateString({ strict: true }) transactionDate!: string;
}

export class BackgroundExpenseInput {
  @IsString() @Length(1, 100) name!: string;
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false }) @Min(0) @Max(9999999999.99) amount!: number;
}
export class SalaryInput {
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsNumber({ maxDecimalPlaces: 2, allowInfinity: false, allowNaN: false }) @Min(0) @Max(9999999999.99) salary!: number;
  @IsInt() @Min(1) @Max(31) payday!: number;
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BackgroundExpenseInput) background!: BackgroundExpenseInput[];
}

export class BudgetInput {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) month!: string;
  @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9999999999.99) amount!: number;
}
export class PendingInput {
  @IsIn(['confirm', 'ignore']) action!: 'confirm' | 'ignore';
  @IsOptional() @IsUUID() categoryId?: string;
}
export class RuleInput {
  @IsString() @Length(1, 120) merchant!: string;
  @IsUUID() categoryId!: string;
}

@Controller('mini-app')
export class MiniAppPageController {
  @Get() @Header('Content-Type', 'text/html; charset=utf-8') @Header('Cache-Control', 'no-store')
  page() { return readFileSync(join(process.cwd(), 'public/mini-app/index.html'), 'utf8'); }
  @Get('app.js') @Header('Content-Type', 'application/javascript') @Header('Cache-Control', 'no-cache')
  script() { return readFileSync(join(process.cwd(), 'public/mini-app/app.js'), 'utf8'); }
  @Get('style.css') @Header('Content-Type', 'text/css') @Header('Cache-Control', 'no-cache')
  style() { return readFileSync(join(process.cwd(), 'public/mini-app/style.css'), 'utf8'); }
}

@Controller('api/mini-app')
@UseGuards(TelegramAuthGuard)
export class MiniAppController {
  constructor(private readonly expenses: ExpensesService, private readonly prisma: PrismaService, private readonly undo: UndoService, private readonly categoriesService: CategoriesService) {}
  private async user(telegramId: string) {
    return await this.prisma.user.findUnique({ where: { telegramId } }) ?? this.expenses.getOrCreateOwnerUser({ id: telegramId });
  }
  @Get('report') @Header('Cache-Control', 'no-store')
  async report(@Req() req: { telegramId: string }, @Query('period') period = 'm', @Query('anchor') anchor?: string) {
    if (!['w', 'm'].includes(period) || (anchor !== undefined && !/^\d{8}$/.test(anchor))) throw new BadRequestException('Invalid period');
    const user = await this.user(req.telegramId);
    try { return await this.expenses.getPeriodReport(user.id, period as 'w' | 'm', anchor); }
    catch (error) { if (error instanceof Error && error.message === 'Invalid report date') throw new BadRequestException(error.message); throw error; }
  }
  private async calculateSalary(user: { id: string; timezone: string }, plan: SalaryInput, configured: boolean) {
    const now = new Date();
    const cycle = salaryCycle(plan.payday, user.timezone, now);
    const aggregate = await this.prisma.expense.aggregate({ where: { userId: user.id, currency: plan.currency, transactionDate: { gte: cycle.start, lte: now } }, _sum: { amount: true }, _count: true });
    const background = plan.background.reduce((total, row) => total.add(row.amount), new Prisma.Decimal(0)).toNumber();
    const pendingCount = await this.prisma.pendingExpense.count({ where: { userId: user.id, currency: plan.currency, status: { in: ['pending', 'edited'] } } });
    return { configured, plan, cycle, pendingCount, count: aggregate._count, ...salaryResult(Number(plan.salary), background, Number(aggregate._sum.amount ?? 0), cycle.days, cycle.elapsed, aggregate._count) };
  }
  @Get('salary') @Header('Cache-Control', 'no-store')
  async salary(@Req() req: { telegramId: string }, @Query('currency') currency = 'EUR') {
    if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException('Некорректная валюта');
    const user = await this.user(req.telegramId);
    const saved = await this.prisma.salaryPlan.findUnique({ where: { userId_currency: { userId: user.id, currency } } });
    const plan: SalaryInput = saved ? { currency, salary: Number(saved.salary), payday: saved.payday, background: saved.background as unknown as BackgroundExpenseInput[] } : { currency, salary: 0, payday: 27, background: [] };
    return this.calculateSalary(user, plan, !!saved);
  }
  @Post('salary')
  async saveSalary(@Req() req: { telegramId: string }, @Body() input: SalaryInput) {
    const user = await this.user(req.telegramId);
    if (input.background.some(row => !row.name.trim())) throw new BadRequestException('Укажите название фонового расхода');
    const data = { salary: input.salary, payday: input.payday, background: input.background.map(row => ({ name: row.name.trim(), amount: row.amount })) };
    await this.prisma.salaryPlan.upsert({ where: { userId_currency: { userId: user.id, currency: input.currency } }, create: { ...data, userId: user.id, currency: input.currency }, update: data });
    return this.calculateSalary(user, input, true);
  }
  @Get('history') @Header('Cache-Control', 'no-store')
  async history(@Req() req: { telegramId: string }, @Query() query: Record<string, string>) {
    const user = await this.user(req.telegramId);
    const { where, skip } = historyQuery(user.id, query, user.timezone);
    return this.prisma.$transaction(async tx => {
      const rows = await tx.expense.findMany({ where, skip, take: 31, include: { category: true }, orderBy: [{ transactionDate: 'desc' }, { id: 'desc' }] });
      const total = await tx.expense.count({ where });
      const totals = await tx.expense.groupBy({ by: ['currency'], where, _sum: { amount: true } });
      const currencies = await tx.expense.findMany({ where: { userId: user.id }, distinct: ['currency'], select: { currency: true }, orderBy: { currency: 'asc' } });
      return { rows: rows.slice(0, 30), total, totals: totals.map(t => ({ currency: t.currency, amount: t._sum.amount })), currencies: currencies.map(c => c.currency), nextOffset: rows.length > 30 ? skip + 30 : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  @Delete('expenses/:id')
  async remove(@Req() req: { telegramId: string }, @Param('id') id: string) {
    const user = await this.user(req.telegramId);
    return this.undo.run(user.id, async tx => {
      const result = await tx.expense.deleteMany({ where: { id, userId: user.id } });
      if (!result.count) throw new NotFoundException('Расход не найден');
      return { ok: true };
    });
  }
  @Get('categories') @Header('Cache-Control', 'no-store')
  async categories(@Req() req: { telegramId: string }) {
    const user = await this.user(req.telegramId);
    return this.prisma.category.findMany({ where: { type: 'expense', OR: [{ userId: null }, { userId: user.id }] }, orderBy: { name: 'asc' } });
  }
  private async data(input: ExpenseInput, userId: string) {
    const category = await this.prisma.category.findFirst({ where: { id: input.categoryId, type: 'expense', OR: [{ userId: null }, { userId }] } });
    if (!category || !input.merchant.trim() || !/(Z|[+-]\d{2}:\d{2})$/.test(input.transactionDate)) throw new BadRequestException('Invalid expense');
    const { applyToMerchant, ...fields } = input;
    return { ...fields, merchant: input.merchant.trim(), amount: new Prisma.Decimal(input.amount), transactionDate: new Date(input.transactionDate) };
  }
  @Post('expenses')
  async create(@Req() req: { telegramId: string }, @Body() input: ExpenseInput) {
    const user = await this.user(req.telegramId);
    const data = await this.data(input, user.id);
    return this.undo.run(user.id, tx => tx.expense.create({ data: { ...data, userId: user.id, source: 'manual' } }));
  }
  @Patch('expenses/:id')
  async update(@Req() req: { telegramId: string }, @Param('id') id: string, @Body() input: ExpenseInput) {
    const user = await this.user(req.telegramId);
    await this.expenses.getExpense(id, user.id);
    const data = await this.data(input, user.id);
    return this.undo.run(user.id, async tx => {
      const expense = await tx.expense.update({ where: { id }, data });
      const affectedExpenses = (input.applyToMerchant ?? true) ? await this.categoriesService.applyMerchantCategory(tx, user.id, data.merchant, data.categoryId) : 1;
      return { ...expense, affectedExpenses };
    });
  }
  @Get('overview') @Header('Cache-Control', 'no-store')
  async overview(@Req() req: { telegramId: string }, @Query('month') month?: string) {
    const user = await this.user(req.telegramId);
    const report = await this.expenses.getPeriodReport(user.id, 'm');
    const currentMonth = dayjs(report.range.start).tz(report.range.timezone).format('YYYY-MM');
    const selected = month ?? currentMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(selected)) throw new BadRequestException('Invalid month');
    const [budgets, pending, lastAction, rules] = await Promise.all([
      this.prisma.monthlyBudget.findMany({ where: { userId: user.id, month: selected } }),
      this.prisma.pendingExpense.findMany({ where: { userId: user.id, status: { in: ['pending', 'edited'] } }, include: { category: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.undoAction.findFirst({ where: { userId: user.id, undoneAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, expiresAt: true } }),
      this.prisma.merchantRule.findMany({ where: { userId: user.id, merchantName: { not: null } }, include: { category: true }, orderBy: { merchantName: 'asc' } }),
    ]);
    return { budgets, pending, lastAction, rules, currentMonth };
  }
  @Post('budget')
  async budget(@Req() req: { telegramId: string }, @Body() input: BudgetInput) {
    const user = await this.user(req.telegramId);
    return this.undo.run(user.id, async tx => {
      const where = { userId: user.id, month: input.month, currency: input.currency };
      if (input.amount === 0) { await tx.monthlyBudget.deleteMany({ where }); return { ok: true }; }
      return tx.monthlyBudget.upsert({ where: { userId_month_currency: where }, create: { ...where, amount: input.amount }, update: { amount: input.amount } });
    });
  }
  @Post('pending/:id')
  async pending(@Req() req: { telegramId: string }, @Param('id') id: string, @Body() input: PendingInput) {
    const user = await this.user(req.telegramId);
    return this.undo.run(user.id, async tx => {
      if (input.categoryId && !await tx.category.findFirst({ where: { id: input.categoryId, type: 'expense', OR: [{ userId: null }, { userId: user.id }] } })) throw new BadRequestException('Invalid category');
      return resolvePending(tx, id, input.action, user.id, input.categoryId);
    });
  }
  @Post('undo/:id')
  async undoAction(@Req() req: { telegramId: string }, @Param('id') id: string) {
    const user = await this.user(req.telegramId);
    return this.undo.undo(user.id, id);
  }
  @Get('merchant-count') @Header('Cache-Control', 'no-store')
  async merchantCount(@Req() req: { telegramId: string }, @Query('merchant') merchant = '') {
    const user = await this.user(req.telegramId);
    const rows = await this.prisma.expense.findMany({ where: { userId: user.id }, select: { merchant: true } });
    return { count: rows.filter(row => merchantKey(row.merchant) === merchantKey(merchant)).length };
  }
  @Post('rules')
  async rule(@Req() req: { telegramId: string }, @Body() input: RuleInput) {
    const user = await this.user(req.telegramId);
    return this.undo.run(user.id, async tx => ({ affectedExpenses: await this.categoriesService.applyMerchantCategory(tx, user.id, input.merchant, input.categoryId) }));
  }

}
