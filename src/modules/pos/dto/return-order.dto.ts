import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReturnOrderItemDto {
  @IsNotEmpty()
  @IsString()
  orderItemId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;
}

export class ReturnOrderDto {
  @IsNotEmpty()
  @IsString()
  originalOrderId: string;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReturnOrderItemDto)
  items: ReturnOrderItemDto[];
}
