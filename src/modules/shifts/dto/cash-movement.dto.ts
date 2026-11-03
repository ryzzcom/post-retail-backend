import { IsEnum, IsNumber, IsOptional, IsPositive, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { CashDrawerAdjustmentType } from '@prisma/client';

export class CashMovementDto {
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    return value.trim().toUpperCase().replace(/-/g, '_') as CashDrawerAdjustmentType;
  })
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
