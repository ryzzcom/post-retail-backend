import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class WhatsAppReminderDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(5)
  message: string;
}
