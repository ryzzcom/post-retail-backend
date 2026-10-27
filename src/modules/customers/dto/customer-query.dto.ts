import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum CustomerFilter {
  ALL = 'ALL',
  GOLD = 'GOLD',
  SILVER = 'SILVER',
  REGULAR = 'REGULAR',
  HAS_KHATA = 'HAS_KHATA',
  PROMOTIONS_OPT_IN = 'PROMOTIONS_OPT_IN',
}

export enum CustomerSortBy {
  HIGHEST_SPEND = 'HIGHEST_SPEND',
  LOWEST_SPEND = 'LOWEST_SPEND',
  MOST_POINTS = 'MOST_POINTS',
  HIGHEST_KHATA = 'HIGHEST_KHATA',
  RECENT_VISIT = 'RECENT_VISIT',
  NAME_ASC = 'NAME_ASC',
}

export class CustomerQueryDto {
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
  @IsEnum(CustomerFilter)
  filter?: CustomerFilter = CustomerFilter.ALL;

  @IsOptional()
  @IsEnum(CustomerSortBy)
  sortBy?: CustomerSortBy = CustomerSortBy.HIGHEST_SPEND;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
