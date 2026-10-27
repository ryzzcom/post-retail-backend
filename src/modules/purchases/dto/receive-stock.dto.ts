import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveStockItemDto {
  @IsNotEmpty()
  @IsString()
  itemId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  receiveQty: number;
}

export class ReceiveStockDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockItemDto)
  items?: ReceiveStockItemDto[];

  @IsOptional()
  @IsString()
  note?: string;
}
