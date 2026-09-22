CREATE TABLE "SalaryPlan" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "salary" DECIMAL(12,2) NOT NULL,
  "payday" INTEGER NOT NULL DEFAULT 27,
  "background" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalaryPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalaryPlan_userId_currency_key" ON "SalaryPlan"("userId", "currency");
ALTER TABLE "SalaryPlan" ADD CONSTRAINT "SalaryPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
