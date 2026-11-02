import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ExpensePaidFrom } from '@prisma/client';

export class PayExpenseDto {
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number; // PKR Rupees - defaults to full remaining balance if omitted

  @IsNotEmpty()
  @IsEnum(ExpensePaidFrom)
  paidFrom: ExpensePaidFrom; // CASH_DRAWER | BANK | PETTY_CASH

  @IsOptional()
  @IsString()
  referenceNo?: string;
}
