import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CouponType } from '@prisma/client';

export class CreateCouponDto {
  @IsNotEmpty()
  @IsString()
  code: string;

  @IsOptional()
  @IsEnum(CouponType)
  type: CouponType = CouponType.PERCENTAGE;

  @IsNotEmpty()
  @IsString()
  title: string;

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  discountPct?: number; // e.g. 10 for 10%

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  discountAmount?: number; // in standard PKR Rupees

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  maxDiscountAmount?: number = 0; // in standard PKR Rupees (0 = no cap)

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minBillAmount?: number = 0; // in standard PKR Rupees

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  usesPerCustomer?: number = 1; // 0 = unlimited

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  totalUsesLimit?: number = 0; // 0 = unlimited

  @IsNotEmpty()
  @IsDateString()
  startsAt: string;

  @IsOptional()
  @IsDateString()
  endsAt?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eligibleCategories?: string[] = [];

  @IsOptional()
  @IsBoolean()
  firstPurchaseOnly?: boolean = false;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
