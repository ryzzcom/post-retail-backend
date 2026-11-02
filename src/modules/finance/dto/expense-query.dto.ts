import { IsOptional, IsString, IsIn, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class ExpenseQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;

  @IsOptional()
  @IsString()
  month?: string; // Format "YYYY-MM", e.g. "2026-10"

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['ALL', 'PAID', 'PARTIAL', 'UNPAID'])
  status?: 'ALL' | 'PAID' | 'PARTIAL' | 'UNPAID' = 'ALL';

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
