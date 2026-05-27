import { IsDateString, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class IncomingBankMessageDto {
  @IsIn(['ios_shortcuts'])
  source: 'ios_shortcuts';

  @IsString()
  @MinLength(1)
  secret: string;

  @IsOptional()
  @IsString()
  sender?: string;

  @IsString()
  @MinLength(1)
  text: string;

  @IsOptional()
  @IsDateString()
  receivedAt?: string;
}
