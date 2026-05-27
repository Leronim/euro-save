import { Module } from '@nestjs/common';
import { BankMessageParserService } from './bank-message-parser.service';
import { ManualExpenseParserService } from './manual-expense-parser.service';

@Module({
  providers: [BankMessageParserService, ManualExpenseParserService],
  exports: [BankMessageParserService, ManualExpenseParserService],
})
export class ParserModule {}
