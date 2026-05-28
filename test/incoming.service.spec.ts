import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { IncomingService } from '../src/incoming/incoming.service';

describe('IncomingService', () => {
  const dto = {
    source: 'ios_shortcuts' as const,
    secret: 'secret',
    sender: 'Eurobank',
    text: 'Purchase 12.40 EUR at LIDL',
    receivedAt: '2026-05-27T21:30:00+03:00',
  };

  const createService = () => {
    const config = { get: jest.fn((key: string) => (key === 'IOS_SHORTCUT_SECRET' ? 'secret' : undefined)) };
    const prisma = {
      incomingBankMessage: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const parser = { parse: jest.fn() };
    const expenses = {
      getOrCreateOwnerUser: jest.fn(),
      createPendingFromParsed: jest.fn(),
      getPendingExpense: jest.fn(),
    };
    const telegram = {
      sendPendingExpenseConfirmation: jest.fn(),
      sendPossibleNonExpenseMessage: jest.fn(),
    };

    return {
      config,
      prisma,
      parser,
      expenses,
      telegram,
      service: new IncomingService(config as never, prisma as never, parser as never, expenses as never, telegram as never),
    };
  };

  it('rejects invalid secret', async () => {
    const { service } = createService();

    await expect(service.handleBankMessage({ ...dto, secret: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns duplicate response when dedup hash already exists', async () => {
    const { prisma, service } = createService();
    prisma.incomingBankMessage.findUnique.mockResolvedValue({ id: 'incoming-1' });

    await expect(service.handleBankMessage(dto)).resolves.toEqual({
      ok: true,
      duplicate: true,
      incomingMessageId: 'incoming-1',
    });
  });

  it('creates pending expense and sends telegram confirmation for expense messages', async () => {
    const { prisma, parser, expenses, telegram, service } = createService();
    prisma.incomingBankMessage.findUnique.mockResolvedValue(undefined);
    prisma.incomingBankMessage.create.mockResolvedValue({ id: 'incoming-1' });
    prisma.incomingBankMessage.update.mockResolvedValue({});
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    parser.parse.mockReturnValue({ amount: 12.4, currency: 'EUR', merchant: 'LIDL', type: 'expense' });
    expenses.createPendingFromParsed.mockResolvedValue({
      id: 'pending-1',
      amount: 12.4,
      currency: 'EUR',
      merchant: 'LIDL',
    });
    expenses.getPendingExpense.mockResolvedValue({ category: { name: 'Продукты' } });

    await expect(service.handleBankMessage(dto)).resolves.toMatchObject({
      ok: true,
      incomingMessageId: 'incoming-1',
      pendingExpenseId: 'pending-1',
      parsed: {
        amount: 12.4,
        currency: 'EUR',
        merchant: 'LIDL',
        category: 'Продукты',
      },
    });
    expect(telegram.sendPendingExpenseConfirmation).toHaveBeenCalledWith('pending-1');
    expect(prisma.incomingBankMessage.update).toHaveBeenCalledWith({
      where: { id: 'incoming-1' },
      data: { parsedStatus: 'parsed' },
    });
  });

  it('ignores declined or non-expense messages', async () => {
    const { prisma, parser, expenses, telegram, service } = createService();
    prisma.incomingBankMessage.findUnique.mockResolvedValue(undefined);
    prisma.incomingBankMessage.create.mockResolvedValue({ id: 'incoming-1' });
    prisma.incomingBankMessage.update.mockResolvedValue({});
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    parser.parse.mockReturnValue({ amount: 12.4, currency: 'EUR', type: 'unknown', status: 'declined' });

    await expect(service.handleBankMessage(dto)).resolves.toEqual({
      ok: false,
      incomingMessageId: 'incoming-1',
      error: 'Message is not an expense',
    });
    expect(telegram.sendPossibleNonExpenseMessage).toHaveBeenCalledWith(dto.text, 'declined');
    expect(expenses.createPendingFromParsed).not.toHaveBeenCalled();
  });

  it('marks incoming message failed when parsing amount fails', async () => {
    const { prisma, parser, expenses, service } = createService();
    prisma.incomingBankMessage.findUnique.mockResolvedValue(undefined);
    prisma.incomingBankMessage.create.mockResolvedValue({ id: 'incoming-1' });
    prisma.incomingBankMessage.update.mockResolvedValue({});
    expenses.getOrCreateOwnerUser.mockResolvedValue({ id: 'user-1' });
    parser.parse.mockReturnValue({ type: 'unknown' });

    await expect(service.handleBankMessage(dto)).resolves.toEqual({
      ok: false,
      incomingMessageId: 'incoming-1',
      error: 'Unable to parse amount',
    });
    expect(prisma.incomingBankMessage.update).toHaveBeenLastCalledWith({
      where: { id: 'incoming-1' },
      data: {
        parsedStatus: 'failed',
        parseError: new BadRequestException('Unable to parse amount').message,
      },
    });
  });
});
