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
import { Type, Transform } from 'class-transformer';
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
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = value.trim().toUpperCase().replace(/-/g, '_');
    if (normalized === 'JAZZCASH_EASYPAISA' || normalized === 'JAZZCASH' || normalized === 'EASYPAISA') {
      return PaymentMethod.WALLET;
    }
    if (normalized === 'KHATA_CREDIT') {
      return PaymentMethod.KHATA;
    }
    return normalized as PaymentMethod;
  })
  @IsEnum(PaymentMethod)
  method: PaymentMethod;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number; // PKR Rupees

  @IsOptional()
  @IsNumber()
  @Min(0)
  cashTendered?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  changeDue?: number;

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  reference?: string;
}

export class CheckoutDto {
  @IsOptional()
  @IsString()
  counterId?: string = '1';

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  billDiscount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pointsRedeemed?: number; // Loyalty points redeemed (1 pt = 1 PKR)

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutPaymentDto)
  payments: CheckoutPaymentDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
