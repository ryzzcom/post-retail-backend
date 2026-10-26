import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type PaymentMethodFilter =
  | 'ALL'
  | 'CASH'
  | 'CARD'
  | 'BANK_TRANSFER'
  | 'WALLET'
  | 'KHATA';

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
  limit: number = 5;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ALL', 'CASH', 'CARD', 'BANK_TRANSFER', 'WALLET', 'KHATA'])
  paymentMethod: PaymentMethodFilter = 'ALL';

  @IsOptional()
  @IsString()
  cashierId?: string;

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
