import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ExpensePaymentMethod } from '@prisma/client';

export class CreateExpenseDto {
  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsNotEmpty()
  @IsString()
  category: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  expenseAmount: number; // PKR Rupees

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ExpensePaymentMethod)
  paymentMethod?: ExpensePaymentMethod;
}
