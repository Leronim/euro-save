import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsDateString, IsNumber, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';
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
  constructor(private readonly expenses: ExpensesService, private readonly prisma: PrismaService) {}
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
    return this.prisma.expense.create({ data: { ...await this.data(input, user.id), userId: user.id, source: 'manual' } });
  }
  @Patch('expenses/:id')
  async update(@Req() req: { telegramId: string }, @Param('id') id: string, @Body() input: ExpenseInput) {
    const user = await this.user(req.telegramId);
    await this.expenses.getExpense(id, user.id);
    return this.expenses.saveExpenseEdit(id, user.id, await this.data(input, user.id), input.applyToMerchant ?? true);
  }
}
