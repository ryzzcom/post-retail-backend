import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { CashDrawerAdjustmentType } from '@prisma/client';

export class CashMovementDto {
  @IsEnum(CashDrawerAdjustmentType)
  type: CashDrawerAdjustmentType;

  @IsNumber()
  @IsPositive()
  amount: number; // PKR Rupees

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
