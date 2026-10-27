import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseStatus, PurchasePaymentStatus } from '@prisma/client';

export class PurchaseQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string; // 'ALL' | PurchaseStatus

  @IsOptional()
  @IsString()
  paymentStatus?: string; // 'ALL' | PurchasePaymentStatus

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
