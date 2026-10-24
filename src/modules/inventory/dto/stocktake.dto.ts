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
  countedQuantity: number;
}

export class StocktakeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StocktakeItemDto)
  items: StocktakeItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
