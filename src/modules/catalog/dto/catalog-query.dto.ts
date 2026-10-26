import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export enum CatalogSortBy {
  NAME_ASC = 'NAME_ASC',
  NAME_DESC = 'NAME_DESC',
  STOCK_ASC = 'STOCK_ASC',
  STOCK_DESC = 'STOCK_DESC',
  PRICE_ASC = 'PRICE_ASC',
  PRICE_DESC = 'PRICE_DESC',
}

export enum CatalogProductStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
  ALL = 'ALL',
}

export class CatalogQueryDto {
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
  categoryId?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(CatalogProductStatus)
  status: CatalogProductStatus = CatalogProductStatus.ACTIVE;

  @IsOptional()
  @IsEnum(CatalogSortBy)
  sortBy: CatalogSortBy = CatalogSortBy.NAME_ASC;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === 1 || value === '1')
  @IsBoolean()
  lowStockOnly?: boolean;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}
