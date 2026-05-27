export type CreatePendingExpenseDto = {
  amount: number;
  currency: string;
  merchant?: string;
  description?: string;
  transactionDate?: Date;
};
