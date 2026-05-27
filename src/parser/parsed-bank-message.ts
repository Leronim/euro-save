export type ParsedBankMessage = {
  amount?: number;
  currency?: string;
  merchant?: string;
  description?: string;
  transactionDate?: Date;
  transactionTime?: string;
  cardLast4?: string;
  type: 'expense' | 'income' | 'unknown';
  status?: 'authorised' | 'declined' | 'reversed' | 'unknown';
};
