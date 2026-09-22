CREATE TABLE "MonthlyBudget" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "month" TEXT NOT NULL,
  "currency" TEXT NOT NULL, "amount" DECIMAL(12,2) NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonthlyBudget_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MonthlyBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MonthlyBudget_userId_month_currency_key" ON "MonthlyBudget"("userId", "month", "currency");
CREATE TABLE "UndoAction" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL, "undoneAt" TIMESTAMP(3),
  CONSTRAINT "UndoAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UndoAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UndoAction_userId_createdAt_idx" ON "UndoAction"("userId", "createdAt");
