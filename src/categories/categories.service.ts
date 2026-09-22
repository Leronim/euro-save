import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { merchantKey } from './merchant-key';
import { Category, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_CATEGORIES, DEFAULT_MERCHANT_RULES } from './default-rules';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSystemCategories() {
    for (const category of DEFAULT_CATEGORIES) {
      const existing = await this.prisma.category.findFirst({
        where: { userId: null, name: category.name, type: 'expense' },
      });
      if (existing) {
        await this.prisma.category.update({ where: { id: existing.id }, data: { emoji: category.emoji } });
      } else {
        await this.prisma.category.create({ data: { name: category.name, emoji: category.emoji, type: 'expense' } });
      }
    }
  }

  async ensureDefaultMerchantRules(userId: string) {
    await this.ensureSystemCategories();

    for (const rule of DEFAULT_MERCHANT_RULES) {
      const category = await this.findSystemCategoryByName(rule.categoryName);
      await this.prisma.merchantRule.upsert({
        where: {
          userId_pattern: {
            userId,
            pattern: rule.pattern,
          },
        },
        update: {},
        create: {
          userId,
          pattern: rule.pattern,
          categoryId: category.id,
        },
      });
    }
  }

  async categorizeMerchant(userId: string, merchant?: string): Promise<Category> {
    if (!merchant) return this.getFallbackCategory();

    const rules = await this.prisma.merchantRule.findMany({
      where: { userId },
      include: { category: true },
      orderBy: { pattern: 'desc' },
    });
    const normalized = merchant.toLowerCase();
    const learned = rules.find(rule => rule.merchantName && merchantKey(rule.merchantName) === merchantKey(merchant));
    const match = learned ?? rules.find((rule) => !rule.merchantName && normalized.includes(rule.pattern.toLowerCase()));

    return match?.category ?? this.getFallbackCategory();
  }

  async applyMerchantCategory(tx: Prisma.TransactionClient, userId: string, merchant: string, categoryId: string) {
    const key = merchantKey(merchant);
    if (!key) throw new BadRequestException('Merchant is required');
    const category = await tx.category.findFirst({
      where: { id: categoryId, type: 'expense', OR: [{ userId: null }, { userId }] },
    });
    if (!category) throw new BadRequestException('Invalid category');
    await tx.merchantRule.upsert({
      where: { userId_pattern: { userId, pattern: key } },
      update: { categoryId, merchantName: merchant.trim() },
      create: { userId, pattern: key, categoryId, merchantName: merchant.trim() },
    });
    const [expenses, pending] = await Promise.all([
      tx.expense.findMany({ where: { userId }, select: { id: true, merchant: true } }),
      tx.pendingExpense.findMany({ where: { userId, status: { in: ['pending', 'edited'] } }, select: { id: true, merchant: true } }),
    ]);
    const ids = expenses.filter(row => merchantKey(row.merchant) === key).map(row => row.id);
    const pendingIds = pending.filter(row => merchantKey(row.merchant) === key).map(row => row.id);
    const result = await tx.expense.updateMany({ where: { userId, id: { in: ids } }, data: { categoryId } });
    await tx.pendingExpense.updateMany({ where: { userId, id: { in: pendingIds }, status: { in: ['pending', 'edited'] } }, data: { categoryId } });
    return result.count;
  }

  async findSystemCategoryByName(name: string): Promise<Category> {
    const category = await this.prisma.category.findFirst({
      where: {
        userId: null,
        name,
        type: 'expense',
      },
    });
    if (!category) throw new Error(`System category not found: ${name}`);
    return category;
  }

  async getFallbackCategory(): Promise<Category> {
    return this.findSystemCategoryByName('Другое');
  }

  formatCategory(category?: Pick<Category, 'emoji' | 'name'> | null): string {
    if (!category) return '❓ Другое';
    return `${category.emoji ?? ''} ${category.name}`.trim();
  }

  async listExpenseCategories(): Promise<Category[]> {
    await this.ensureSystemCategories();
    return this.prisma.category.findMany({
      where: {
        userId: null,
        type: 'expense',
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
