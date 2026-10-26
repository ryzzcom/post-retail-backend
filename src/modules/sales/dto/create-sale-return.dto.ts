import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnItemDto {
  @IsString()
  @IsNotEmpty()
  orderItemId: string;

  @IsString()
  @IsNotEmpty()
  variantId: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsIn(['RESELLABLE', 'DAMAGED'])
  condition: 'RESELLABLE' | 'DAMAGED';
}

export class CreateSaleReturnDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items: ReturnItemDto[];

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsIn(['CASH', 'ORIGINAL_PAYMENT', 'REDUCE_KHATA', 'EXCHANGE'])
  settlementMethod: 'CASH' | 'ORIGINAL_PAYMENT' | 'REDUCE_KHATA' | 'EXCHANGE';

  @IsOptional()
  @IsString()
  notes?: string;
}

export class WhatsappRetryDto {
  @IsOptional()
  @IsString()
  phone?: string;
}
