import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AdjustStockDto {
  @IsNotEmpty()
  @IsString()
  variantId: string;

  @IsNotEmpty()
  @IsInt()
  quantityDelta: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  referenceNo?: string;
}
