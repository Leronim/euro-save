import { Body, Controller, Post } from '@nestjs/common';
import { IncomingBankMessageDto } from './dto/incoming-bank-message.dto';
import { IncomingService } from './incoming.service';

@Controller('/api/incoming')
export class IncomingController {
  constructor(private readonly incoming: IncomingService) {}

  @Post('/bank-message')
  handleBankMessage(@Body() dto: IncomingBankMessageDto) {
    return this.incoming.handleBankMessage(dto);
  }
}
