import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';

export class KhataQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['all', 'overdue', 'within_terms', 'settled', 'ALL', 'OVERDUE', 'WITHIN_TERMS', 'SETTLED'])
  status?: string = 'all';
}
