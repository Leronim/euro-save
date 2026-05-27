import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CategoriesModule } from './categories/categories.module';
import { validateEnv } from './config/env.validation';
import { ExpensesModule } from './expenses/expenses.module';
import { IncomingModule } from './incoming/incoming.module';
import { ParserModule } from './parser/parser.module';
import { PrismaModule } from './prisma/prisma.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    PrismaModule,
    ParserModule,
    CategoriesModule,
    ExpensesModule,
    TelegramModule,
    IncomingModule,
  ],
})
export class AppModule {}
