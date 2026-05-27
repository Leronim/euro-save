import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const categories = [
  ['Продукты', '🛒'],
  ['Еда', '🍔'],
  ['Кофе', '☕'],
  ['Транспорт', '🚕'],
  ['Дом', '🏠'],
  ['Развлечения', '🎮'],
  ['Здоровье', '💊'],
  ['Одежда', '👕'],
  ['Подписки', '📱'],
  ['Другое', '❓'],
] as const;

async function main() {
  for (const [name, emoji] of categories) {
    const existing = await prisma.category.findFirst({
      where: { userId: null, name, type: 'expense' },
    });
    if (existing) {
      await prisma.category.update({ where: { id: existing.id }, data: { emoji } });
    } else {
      await prisma.category.create({ data: { name, emoji, type: 'expense' } });
    }
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });
