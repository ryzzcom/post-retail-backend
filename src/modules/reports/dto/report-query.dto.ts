import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReportQueryDto {
  @IsOptional()
  @IsIn(['today', 'last7days', 'thismonth', 'custom', 'TODAY', 'LAST7DAYS', 'THISMONTH', 'CUSTOM'])
  preset?: string = 'thismonth';

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @IsIn(['sales', 'inventory', 'finance', 'customers'])
  tab?: 'sales' | 'inventory' | 'finance' | 'customers' = 'sales';
}
