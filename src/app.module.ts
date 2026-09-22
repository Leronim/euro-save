import { UndoService } from './mini-app/undo.service';
import { MiniAppController, MiniAppPageController } from './mini-app/mini-app.controller';
import { TelegramAuthGuard } from './mini-app/telegram-auth.guard';
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
  controllers: [MiniAppController, MiniAppPageController],
  providers: [TelegramAuthGuard, UndoService],
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
