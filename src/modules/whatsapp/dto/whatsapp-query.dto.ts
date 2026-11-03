import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '@core/dto/pagination-query.dto';

export class WhatsAppLogQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(['all', 'sent', 'delivered', 'failed', 'ALL', 'SENT', 'DELIVERED', 'FAILED'])
  status?: string = 'all';

  @IsOptional()
  @IsString()
  category?: string;
}
