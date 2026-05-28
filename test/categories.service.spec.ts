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
