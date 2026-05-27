import { Module } from '@nestjs/common';
import { CategoriesModule } from '../categories/categories.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ParserModule } from '../parser/parser.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [ExpensesModule, CategoriesModule, ParserModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
