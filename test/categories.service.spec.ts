import { CategoriesService } from '../src/categories/categories.service';

describe('CategoriesService', () => {
  const groceries = { id: 'cat-groceries', name: 'Продукты', emoji: '🛒', type: 'expense' };
  const other = { id: 'cat-other', name: 'Другое', emoji: '❓', type: 'expense' };

  const createService = () => {
    const prisma = {
      category: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      merchantRule: {
        findMany: jest.fn(),
        upsert: jest.fn(),
      },
    };

    return {
      prisma,
      service: new CategoriesService(prisma as never),
    };
  };

  it('keeps learned categories when default rules are initialized again', async () => {
    const { prisma, service } = createService();
    prisma.category.findFirst.mockResolvedValue(groceries);
    await service.ensureDefaultMerchantRules('user-1');
    expect(prisma.merchantRule.upsert.mock.calls.every(([query]) => Object.keys(query.update).length === 0)).toBe(true);
  });

  it('uses a learned chain category before generic rules, but does not substring-match unrelated merchants', async () => {
    const { prisma, service } = createService();
    prisma.merchantRule.findMany.mockResolvedValue([
      { pattern: 'CAFE', category: other },
      { pattern: 'ZORBAS', merchantName: 'ZORBAS NICOSIA', category: groceries },
      { pattern: 'ABC', merchantName: 'ABC', category: groceries },
    ]);
    prisma.category.findFirst.mockResolvedValue(other);
    await expect(service.categorizeMerchant('user-1', "Zorba’s Cafe Larnaca")).resolves.toBe(groceries);
    await expect(service.categorizeMerchant('user-1', 'ABCD')).resolves.toBe(other);
  });

  it('updates all matching purchases and pending drafts only for this user', async () => {
    const { service } = createService();
    const tx = {
      category: { findFirst: jest.fn().mockResolvedValue(groceries) },
      merchantRule: { upsert: jest.fn() },
      expense: { findMany: jest.fn().mockResolvedValue([
        { id: 'one', merchant: 'ZORBAS NICOSIA' }, { id: 'two', merchant: 'zorbas larnaca' },
        { id: 'unrelated', merchant: 'ZORBASKI' }, { id: 'blank', merchant: null },
      ]), updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      pendingExpense: { findMany: jest.fn().mockResolvedValue([{ id: 'draft', merchant: 'ZORBAS' }]), updateMany: jest.fn() },
    };
    expect(await service.applyMerchantCategory(tx as any, 'user-1', 'ZORBAS', groceries.id)).toBe(2);
    expect(tx.expense.updateMany).toHaveBeenCalledWith({ where: { userId: 'user-1', id: { in: ['one', 'two'] } }, data: { categoryId: groceries.id } });
    expect(tx.pendingExpense.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', id: { in: ['draft'] }, status: { in: ['pending', 'edited'] } } }));
    expect(tx.merchantRule.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { categoryId: groceries.id, merchantName: 'ZORBAS' } }));
    tx.category.findFirst.mockResolvedValue(null as any);
    await expect(service.applyMerchantCategory(tx as any, 'user-1', 'ZORBAS', 'foreign')).rejects.toThrow();
  });

  it('formats category with emoji and name', () => {
    const { service } = createService();

    expect(service.formatCategory(groceries)).toBe('🛒 Продукты');
    expect(service.formatCategory(null)).toBe('❓ Другое');
  });

  it('categorizes merchant by user rules', async () => {
    const { prisma, service } = createService();
    prisma.merchantRule.findMany.mockResolvedValue([
      { pattern: 'LIDL', category: groceries },
      { pattern: 'WOLT', category: { id: 'cat-food', name: 'Еда', emoji: '🍔' } },
    ]);

    await expect(service.categorizeMerchant('user-1', 'LIDL NICOSIA')).resolves.toBe(groceries);
  });

  it('falls back to other category when merchant has no rule', async () => {
    const { prisma, service } = createService();
    prisma.merchantRule.findMany.mockResolvedValue([]);
    prisma.category.findFirst.mockResolvedValue(other);

    await expect(service.categorizeMerchant('user-1', 'UNKNOWN SHOP')).resolves.toBe(other);
  });

  it('ensures system categories by creating missing categories', async () => {
    const { prisma, service } = createService();
    prisma.category.findFirst.mockResolvedValue(undefined);
    prisma.category.create.mockResolvedValue({});

    await service.ensureSystemCategories();

    expect(prisma.category.create).toHaveBeenCalled();
    expect(prisma.category.create.mock.calls[0][0]).toMatchObject({
      data: { name: 'Продукты', emoji: '🛒', type: 'expense' },
    });
  });
});
