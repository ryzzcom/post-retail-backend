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

export class CartItemDto {
  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  lineTotal: number; // in standard PKR Rupees
}

export class ValidatePosCartDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  redeemPoints?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  cartItems: CartItemDto[];

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  subtotal: number; // in standard PKR Rupees
}
