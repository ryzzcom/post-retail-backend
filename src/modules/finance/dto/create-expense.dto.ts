import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsBoolean,
  Min,
} from 'class-validator';
import { ExpensePaidFrom, ExpensePaymentStatus } from '@prisma/client';

export class CreateExpenseDto {
  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  category: string;

  @IsNotEmpty()
  @IsString()
  vendorName: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number; // PKR Rupees

  @IsOptional()
  @IsNumber()
  @Min(0)
  paidAmount?: number; // PKR Rupees

  @IsNotEmpty()
  @IsEnum(ExpensePaymentStatus)
  paymentStatus: ExpensePaymentStatus; // PAID | PARTIAL | UNPAID

  @IsOptional()
  @IsEnum(ExpensePaidFrom)
  paidFrom?: ExpensePaidFrom; // CASH_DRAWER | BANK | PETTY_CASH | NOT_PAID

  @IsOptional()
  @IsString()
  expenseDate?: string;

  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsBoolean()
  repeatsMonthly?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;
}
