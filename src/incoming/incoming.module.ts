import { Module } from '@nestjs/common';
import { ExpensesModule } from '../expenses/expenses.module';
import { ParserModule } from '../parser/parser.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';
import { IncomingController } from './incoming.controller';
import { IncomingService } from './incoming.service';

@Module({
  imports: [PrismaModule, ParserModule, ExpensesModule, TelegramModule],
  controllers: [IncomingController],
  providers: [IncomingService],
})
export class IncomingModule {}
