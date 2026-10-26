import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum AdjustmentType {
  ADD = 'ADD',
  DEDUCT = 'DEDUCT',
  SET = 'SET',
}

export enum AdjustmentReason {
  ADJUSTMENT = 'ADJUSTMENT',
  DAMAGE = 'DAMAGE',
  RECEIVING = 'RECEIVING',
  RETURN = 'RETURN',
  SHRINKAGE = 'SHRINKAGE',
  OTHER = 'OTHER',
}

export class AdjustStockDto {
  @IsNotEmpty()
  @IsString()
  variantId: string;

  @IsNotEmpty()
  @IsEnum(AdjustmentType)
  adjustmentType: AdjustmentType;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  reorderLevel?: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;
}
