import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc); dayjs.extend(timezone);

export function historyQuery(userId: string, query: Record<string, string>, zone: string) {
  const where: Prisma.ExpenseWhereInput = { userId };
  for (const value of Object.values(query)) if (typeof value !== 'string' || value.length > 200) throw new BadRequestException('Некорректный фильтр');
  const date = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !dayjs.utc(value).isValid() || dayjs.utc(value).format('YYYY-MM-DD') !== value) throw new BadRequestException('Некорректная дата');
    return dayjs.tz(value, zone).toDate();
  };
  if (query.from || query.to) {
    const gte = query.from ? date(query.from) : undefined;
    const end = query.to ? date(query.to) : undefined;
    if (gte && end && gte > end) throw new BadRequestException('Начало периода позже окончания');
    const lt = query.to ? date(dayjs.utc(query.to).add(1, 'day').format('YYYY-MM-DD')) : undefined;
    where.transactionDate = { gte, lt };
  }
  if (query.q?.trim()) where.OR = ['merchant', 'description'].map(field => ({ [field]: { contains: query.q.trim(), mode: 'insensitive' } }));
  if (query.merchant?.trim()) where.merchant = { contains: query.merchant.trim(), mode: 'insensitive' };
  if (query.category) {
    if (query.category !== 'none' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.category)) throw new BadRequestException('Некорректная категория');
    where.categoryId = query.category === 'none' ? null : query.category;
  }
  if (query.currency) {
    if (!/^[A-Z]{3}$/.test(query.currency)) throw new BadRequestException('Некорректная валюта');
    where.currency = query.currency;
  }
  const amount = (value?: string) => {
    if (!value) return undefined;
    if (!/^\d+(\.\d{1,2})?$/.test(value) || Number(value) > 9999999999.99) throw new BadRequestException('Некорректная сумма');
    return new Prisma.Decimal(value);
  };
  const gte = amount(query.min), lte = amount(query.max);
  if (gte && lte && gte.gt(lte)) throw new BadRequestException('Минимальная сумма больше максимальной');
  if (gte || lte) where.amount = { gte, lte };
  if (query.offset && !/^\d{1,7}$/.test(query.offset)) throw new BadRequestException('Некорректная страница');
  return { where, skip: Number(query.offset || 0) };
}
