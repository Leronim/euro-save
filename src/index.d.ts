export type BankMessageType = 'expense' | 'income' | 'unknown';

export type BankMessageStatus = 'authorised' | 'declined' | 'reversed' | 'unknown';

export type ParsedBankMessage = {
  amount?: number;
  currency?: string;
  merchant?: string;
  description?: string;
  transactionDate?: Date;
  transactionTime?: string;
  cardLast4?: string;
  type: BankMessageType;
  status?: BankMessageStatus;
};

export type IncomingBankMessage = {
  text: string;
  receivedAt: Date;
  parsed: ParsedBankMessage;
};

export type PendingExpense = {
  amount?: number;
  currency?: string;
  merchant?: string;
  transactionDate?: Date;
  transactionTime?: string;
  cardLast4?: string;
  category?: string;
  status: 'pending';
  source: 'bank_sms';
};

export type ProcessIncomingBankMessageResult = {
  incomingBankMessage: IncomingBankMessage;
  parsed: ParsedBankMessage;
  pendingExpense?: PendingExpense;
  telegramConfirmation?: string;
};

export declare const CATEGORY_RULES: Array<{
  pattern: string;
  category: string;
}>;

export declare function parseBankMessage(text: string, receivedAt?: Date | string): ParsedBankMessage;

export declare function processIncomingBankMessage(input: {
  text: string;
  receivedAt?: Date | string;
}): ProcessIncomingBankMessageResult;

export declare function detectCardLast4(text: string): string | undefined;

export declare function detectStatus(text: string): BankMessageStatus;

export declare function detectMerchant(text: string): string | undefined;

export declare function detectAmountAndCurrency(text: string): {
  amount: number;
  currency: string;
} | undefined;

export declare function detectTransactionTime(text: string): string | undefined;

export declare function combineReceivedDateWithTime(receivedAt: Date | string, transactionTime: string): Date;

export declare function categorizeMerchant(merchant?: string): string | undefined;

export declare function formatTelegramExpenseConfirmation(expense: PendingExpense): string;

export declare function formatTelegramButtons(): string[];
