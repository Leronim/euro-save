import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, Expense, Category, PendingExpense } from '@prisma/client';

export function resolvePending(tx: Prisma.TransactionClient, id: string, action: 'confirm', userId?: string, categoryId?: string): Promise<Expense & { category: Category | null }>;
export function resolvePending(tx: Prisma.TransactionClient, id: string, action: 'ignore', userId?: string, categoryId?: string): Promise<PendingExpense>;
export function resolvePending(tx: Prisma.TransactionClient, id: string, action: 'confirm' | 'ignore', userId?: string, categoryId?: string): Promise<Expense | PendingExpense>;
export async function resolvePending(tx: Prisma.TransactionClient, id: string, action: 'confirm' | 'ignore', userId?: string, categoryId?: string): Promise<PendingExpense | (Expense & { category: Category | null })> {
  const pending = await tx.pendingExpense.findUnique({ where: { id } });
  if (!pending || (userId && pending.userId !== userId)) throw new NotFoundException('Покупка не найдена');
  const claimed = await tx.pendingExpense.updateMany({
    where: { id, userId: pending.userId, status: { in: ['pending', 'edited'] } },
    data: { status: action === 'confirm' ? 'confirmed' : 'ignored', ...(categoryId ? { categoryId } : {}) },
  });
  if (!claimed.count) throw new ConflictException('Эта покупка уже обработана');
  if (action === 'ignore') return { ...pending, status: 'ignored' as const };
  return tx.expense.create({ data: {
    userId: pending.userId, amount: pending.amount, currency: pending.currency,
    merchant: pending.merchant, description: pending.description, categoryId: categoryId ?? pending.categoryId,
    transactionDate: pending.transactionDate ?? new Date(), incomingBankMessageId: pending.incomingBankMessageId,
    source: pending.incomingBankMessageId ? 'ios_shortcuts' : 'manual',
  }, include: { category: true } });
}
