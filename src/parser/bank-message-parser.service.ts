import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
dayjs.extend(utc);
dayjs.extend(timezone);
import { ParsedBankMessage } from './parsed-bank-message';

const STATUS_BY_BANK_WORD = {
  AUTHORISED: 'authorised',
  DECLINED: 'declined',
  REVERSED: 'reversed',
} as const;

const EXPENSE_WORDS = ['purchase', 'paid', 'payment', 'card transaction', 'pos', 'debit', 'withdrawal', 'charged'];
const INCOME_WORDS = ['credit', 'refund', 'incoming', 'received', 'deposit', 'reversal'];

@Injectable()
export class BankMessageParserService {
  parse(text: string, receivedAt?: Date | string): ParsedBankMessage {
    const source = text.trim();
    const eurobank = this.parseEurobankHellenic(source, receivedAt);
    if (eurobank.status && eurobank.status !== 'unknown') {
      return eurobank;
    }

    const amount = this.detectAmountAndCurrency(source);
    const type = this.detectType(source);
    const merchant = this.detectGenericMerchant(source);

    return {
      amount: amount?.amount,
      currency: amount?.currency,
      merchant,
      type,
    };
  }

  private parseEurobankHellenic(text: string, receivedAt?: Date | string): ParsedBankMessage {
    const status = this.detectStatus(text);
    const amount = this.detectAmountAndCurrency(text);
    const transactionTime = this.detectTransactionTime(text);
    const transactionDate =
      receivedAt && transactionTime ? this.combineReceivedDateWithTime(receivedAt, transactionTime) : undefined;

    return {
      amount: amount?.amount,
      currency: amount?.currency,
      merchant: this.detectEurobankMerchant(text),
      transactionDate,
      transactionTime,
      cardLast4: this.detectCardLast4(text),
      type: status === 'authorised' ? 'expense' : status === 'reversed' ? 'income' : 'unknown',
      status,
    };
  }

  private detectStatus(text: string): ParsedBankMessage['status'] {
    const match = text.match(/\bWAS\s+(AUTHORISED|DECLINED|REVERSED)\b/i);
    if (!match) return 'unknown';

    return STATUS_BY_BANK_WORD[match[1].toUpperCase() as keyof typeof STATUS_BY_BANK_WORD] ?? 'unknown';
  }

  private detectType(text: string): ParsedBankMessage['type'] {
    const normalized = text.toLowerCase();
    if (INCOME_WORDS.some((word) => normalized.includes(word))) return 'income';
    if (EXPENSE_WORDS.some((word) => normalized.includes(word))) return 'expense';
    return 'unknown';
  }

  private detectCardLast4(text: string): string | undefined {
    const cardMatch = text.match(/\bCARD\s+\*{1,}(\d{4})\b/i);
    if (cardMatch) return cardMatch[1];

    const standaloneMatch = text.match(/(?:^|\s)\*(\d{4})\b/i);
    return standaloneMatch?.[1];
  }

  private detectEurobankMerchant(text: string): string | undefined {
    const match = text.match(/\bWAS\s+(?:AUTHORISED|DECLINED|REVERSED)\s+FOR\s+(.+?),\s*(?=(?:€|\d|EUR\b))/i);
    return match?.[1]?.replace(/\s+/g, ' ').trim();
  }

  private detectGenericMerchant(text: string): string | undefined {
    const atMatch = text.match(/\bat\s+([A-Z0-9][A-Z0-9 .&'/-]+?)(?:\s+on\b|\s+at\b|$)/i);
    if (atMatch) return this.cleanupMerchant(atMatch[1]);

    const fromMatch = text.match(/\bfrom\s+([A-Z0-9][A-Z0-9 .&'/-]+?)(?:\s+on\b|\s+at\b|$)/i);
    if (fromMatch) return this.cleanupMerchant(fromMatch[1]);

    return undefined;
  }

  private detectAmountAndCurrency(text: string): { amount: number; currency: string } | undefined {
    const symbolBefore = text.match(/([€$£])\s*(\d+(?:[,.]\d{1,2})?)/);
    if (symbolBefore) {
      return {
        amount: this.normalizeAmount(symbolBefore[2]),
        currency: this.currencyFromSymbol(symbolBefore[1]),
      };
    }

    const codeBefore = text.match(/\b(EUR|USD|GBP)\s+(\d+(?:[,.]\d{1,2})?)\b/i);
    if (codeBefore) {
      return {
        amount: this.normalizeAmount(codeBefore[2]),
        currency: codeBefore[1].toUpperCase(),
      };
    }

    const codeAfter = text.match(/\b(\d+(?:[,.]\d{1,2})?)\s+(EUR|USD|GBP)\b/i);
    if (codeAfter) {
      return {
        amount: this.normalizeAmount(codeAfter[1]),
        currency: codeAfter[2].toUpperCase(),
      };
    }

    const amountLabel = text.match(/\bAmount:\s*(\d+(?:[,.]\d{1,2})?)\b/i);
    if (amountLabel) return { amount: this.normalizeAmount(amountLabel[1]), currency: 'EUR' };

    const purchaseAmount = text.match(/\bPurchase\s+(\d+(?:[,.]\d{1,2})?)\b/i);
    if (purchaseAmount) return { amount: this.normalizeAmount(purchaseAmount[1]), currency: 'EUR' };

    return undefined;
  }

  private detectTransactionTime(text: string): string | undefined {
    const match = text.match(/\bAT\s+([01]\d|2[0-3]):([0-5]\d)\b/i);
    return match ? `${match[1]}:${match[2]}` : undefined;
  }

  private combineReceivedDateWithTime(receivedAt: Date | string, transactionTime: string): Date {
    // Eurobank/Hellenic SMS clock times are Cyprus local time, not the server's UTC.
    const zone = 'Europe/Nicosia';
    const received = dayjs(receivedAt).tz(zone);
    let date = received.format('YYYY-MM-DD');
    let transaction = dayjs.tz(`${date} ${transactionTime}`, zone);
    // An SMS just after midnight may refer to a purchase before midnight.
    // Keep a small clock-skew allowance; never turn a late-evening purchase into tomorrow's.
    if (transaction.diff(received, 'hour', true) > 12) {
      date = dayjs.utc(date).subtract(1, 'day').format('YYYY-MM-DD');
      transaction = dayjs.tz(`${date} ${transactionTime}`, zone);
    }
    return transaction.toDate();
  }

  private normalizeAmount(value: string): number {
    return Number(value.replace(',', '.'));
  }

  private currencyFromSymbol(symbol: string): string {
    if (symbol === '$') return 'USD';
    if (symbol === '£') return 'GBP';
    return 'EUR';
  }

  private cleanupMerchant(value: string): string {
    return value.replace(/\s+/g, ' ').trim().replace(/[,.]$/, '').toUpperCase();
  }
}
