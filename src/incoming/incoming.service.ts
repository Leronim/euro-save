import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { dayKey } from '../common/utils/date';
import { sha256 } from '../common/utils/hash';
import { ExpensesService } from '../expenses/expenses.service';
import { BankMessageParserService } from '../parser/bank-message-parser.service';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import { IncomingBankMessageDto } from './dto/incoming-bank-message.dto';

@Injectable()
export class IncomingService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly parser: BankMessageParserService,
    private readonly expenses: ExpensesService,
    private readonly telegram: TelegramService,
  ) {}

  async handleBankMessage(dto: IncomingBankMessageDto) {
    const expectedSecret = this.config.get<string>('IOS_SHORTCUT_SECRET');
    if (!expectedSecret || dto.secret !== expectedSecret) {
      throw new UnauthorizedException('Invalid secret');
    }

    const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();
    const dedupHash = sha256([dto.sender ?? '', dto.text, dayKey(receivedAt)].join('|'));
    const existing = await this.prisma.incomingBankMessage.findUnique({ where: { dedupHash } });
    if (existing) {
      return {
        ok: true,
        duplicate: true,
        incomingMessageId: existing.id,
      };
    }

    const incomingMessage = await this.prisma.incomingBankMessage.create({
      data: {
        source: 'ios_shortcuts',
        sender: dto.sender,
        text: dto.text,
        receivedAt,
        rawPayload: dto as unknown as Prisma.InputJsonValue,
        parsedStatus: 'pending',
        dedupHash,
      },
    });

    try {
      const owner = await this.expenses.getOrCreateOwnerUser();
      const parsed = this.parser.parse(dto.text, receivedAt);

      if (!parsed.amount || !parsed.currency) {
        throw new BadRequestException('Unable to parse amount');
      }

      if (parsed.type !== 'expense' || parsed.status === 'declined' || parsed.status === 'reversed') {
        await this.prisma.incomingBankMessage.update({
          where: { id: incomingMessage.id },
          data: { parsedStatus: 'ignored' },
        });
        await this.telegram.sendPossibleNonExpenseMessage(dto.text, parsed.status ?? parsed.type);
        return {
          ok: false,
          incomingMessageId: incomingMessage.id,
          error: 'Message is not an expense',
        };
      }

      const pendingExpense = await this.expenses.createPendingFromParsed({
        userId: owner.id,
        incomingBankMessageId: incomingMessage.id,
        parsed,
        sourceDate: receivedAt,
      });

      await this.prisma.incomingBankMessage.update({
        where: { id: incomingMessage.id },
        data: { parsedStatus: 'parsed' },
      });
      await this.telegram.sendPendingExpenseConfirmation(pendingExpense.id);

      const pendingWithCategory = await this.expenses.getPendingExpense(pendingExpense.id);
      return {
        ok: true,
        incomingMessageId: incomingMessage.id,
        pendingExpenseId: pendingExpense.id,
        parsed: {
          amount: Number(pendingExpense.amount),
          currency: pendingExpense.currency,
          merchant: pendingExpense.merchant,
          category: pendingWithCategory.category?.name,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to parse message';
      await this.prisma.incomingBankMessage.update({
        where: { id: incomingMessage.id },
        data: {
          parsedStatus: 'failed',
          parseError: message,
        },
      });

      return {
        ok: false,
        incomingMessageId: incomingMessage.id,
        error: message,
      };
    }
  }
}
