import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '@prisma/client';

export class CheckoutItemDto {
  @IsNotEmpty()
  @IsString()
  variantId: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  unitPrice: number; // PKR Rupees

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number; // PKR Rupees
}

export class CheckoutPaymentDto {
  @IsNotEmpty()
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number; // PKR Rupees

  @IsOptional()
  @IsString()
  referenceNo?: string;
}

export class CheckoutDto {
  @IsNotEmpty()
  @IsString()
  counterId: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  items: CheckoutItemDto[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number; // Total order discount in PKR Rupees

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutPaymentDto)
  payments: CheckoutPaymentDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
