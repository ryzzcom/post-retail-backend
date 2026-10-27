import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateLoyaltyRulesDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  spendPerPoint?: number; // in PKR Rupees (default: 100)

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Type(() => Number)
  pointValue?: number; // in PKR Rupees (default: 1)

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  minBillToRedeem?: number; // in PKR Rupees (default: 1000)

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  minPointsToRedeem?: number; // default: 100

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  maxPointsPerBill?: number; // default: 1000

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  maxBillPayablePct?: number; // default: 20%

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  pointsExpiryMonths?: number; // default: 12

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  silverTierThreshold?: number; // in PKR Rupees (default: 40000)

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  goldTierThreshold?: number; // in PKR Rupees (default: 150000)

  @IsOptional()
  @IsBoolean()
  reversePointsOnReturn?: boolean; // default: false

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  referralBonusPoints?: number; // default: 300
}
