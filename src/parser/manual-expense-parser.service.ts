import { Injectable } from '@nestjs/common';

export type ParsedManualExpense = {
  amount: number;
  currency: string;
  merchant?: string;
  description?: string;
};

@Injectable()
export class ManualExpenseParserService {
  parse(text: string, defaultCurrency = 'EUR'): ParsedManualExpense | undefined {
    const normalized = text.trim();
    const amountMatch = normalized.match(/(?:^|\s)(\d+(?:[,.]\d{1,2})?)(?:\s|$)/);
    if (!amountMatch) return undefined;

    const amount = Number(amountMatch[1].replace(',', '.'));
    const merchant = normalized
      .replace(amountMatch[0], ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();

    return {
      amount,
      currency: defaultCurrency,
      merchant: merchant || undefined,
      description: merchant || undefined,
    };
  }
}
