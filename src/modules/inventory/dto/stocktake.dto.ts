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

export class StocktakeItemDto {
  @IsNotEmpty()
  @IsString()
  variantId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  countedQty: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class BulkStocktakeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StocktakeItemDto)
  items: StocktakeItemDto[];

  @IsOptional()
  @IsString()
  referenceNote?: string;
}
