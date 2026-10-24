import { IsOptional, IsDateString } from 'class-validator';

export class DateRangeQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
