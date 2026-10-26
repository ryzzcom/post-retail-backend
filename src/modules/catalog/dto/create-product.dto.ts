import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductVariantDto {
  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsNotEmpty()
  @IsString()
  sku: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  costPrice: number; // in standard PKR rupees

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  retailPrice: number; // in standard PKR rupees

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  openingStock: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  reorderLevel: number = 3;
}

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  styleCode?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsOptional()
  @IsString()
  subCategory?: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  season?: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minSellingPrice: number; // in standard PKR rupees

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  handle?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateProductVariantDto)
  variants: CreateProductVariantDto[];
}
