import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ParserModule } from '../parser/parser.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [PrismaModule, CategoriesModule, ParserModule],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
