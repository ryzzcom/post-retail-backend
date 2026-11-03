import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export type PaymentMethodFilter =
  | 'ALL'
  | 'CASH'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'WALLET'
  | 'KHATA'
  | 'SPLIT';

export class SalesHistoryQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return 'ALL';
    const normalized = value.trim().toUpperCase().replace(/-/g, '_');
    if (normalized === 'JAZZCASH_EASYPAISA' || normalized === 'JAZZCASH' || normalized === 'EASYPAISA') {
      return 'WALLET';
    }
    if (normalized === 'KHATA_CREDIT') {
      return 'KHATA';
    }
    return normalized as PaymentMethodFilter;
  })
  @IsIn(['ALL', 'CASH', 'CARD', 'BANK_TRANSFER', 'WALLET', 'KHATA', 'SPLIT'])
  paymentMethod: PaymentMethodFilter = 'ALL';

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsString()
  counterId?: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

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
