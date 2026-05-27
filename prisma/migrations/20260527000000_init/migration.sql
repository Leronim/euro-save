CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "BankMessageSource" AS ENUM ('ios_shortcuts');
CREATE TYPE "ParsedStatus" AS ENUM ('pending', 'parsed', 'failed', 'ignored');
CREATE TYPE "PendingExpenseStatus" AS ENUM ('pending', 'confirmed', 'ignored', 'edited');
CREATE TYPE "ExpenseSource" AS ENUM ('manual', 'ios_shortcuts', 'bank_api', 'csv');
CREATE TYPE "CategoryType" AS ENUM ('expense', 'income');

CREATE TABLE "User" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "telegramId" TEXT NOT NULL,
  "username" TEXT,
  "firstName" TEXT,
  "defaultCurrency" TEXT NOT NULL DEFAULT 'EUR',
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Nicosia',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IncomingBankMessage" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "source" "BankMessageSource" NOT NULL,
  "sender" TEXT,
  "text" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3),
  "rawPayload" JSONB NOT NULL,
  "parsedStatus" "ParsedStatus" NOT NULL DEFAULT 'pending',
  "parseError" TEXT,
  "dedupHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IncomingBankMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Category" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "emoji" TEXT,
  "type" "CategoryType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MerchantRule" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "pattern" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "merchantName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PendingExpense" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "incomingBankMessageId" TEXT,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "merchant" TEXT,
  "description" TEXT,
  "categoryId" TEXT,
  "transactionDate" TIMESTAMP(3),
  "status" "PendingExpenseStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PendingExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL,
  "merchant" TEXT,
  "description" TEXT,
  "categoryId" TEXT,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "source" "ExpenseSource" NOT NULL,
  "incomingBankMessageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
CREATE UNIQUE INDEX "IncomingBankMessage_dedupHash_key" ON "IncomingBankMessage"("dedupHash");
CREATE UNIQUE INDEX "Category_userId_name_type_key" ON "Category"("userId", "name", "type");
CREATE UNIQUE INDEX "MerchantRule_userId_pattern_key" ON "MerchantRule"("userId", "pattern");
CREATE INDEX "Expense_userId_transactionDate_idx" ON "Expense"("userId", "transactionDate");

ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingExpense" ADD CONSTRAINT "PendingExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PendingExpense" ADD CONSTRAINT "PendingExpense_incomingBankMessageId_fkey" FOREIGN KEY ("incomingBankMessageId") REFERENCES "IncomingBankMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PendingExpense" ADD CONSTRAINT "PendingExpense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_incomingBankMessageId_fkey" FOREIGN KEY ("incomingBankMessageId") REFERENCES "IncomingBankMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
