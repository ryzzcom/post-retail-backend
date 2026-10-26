import { IsArray, IsOptional, IsString } from 'class-validator';

export class CsvImportDto {
  @IsOptional()
  @IsString()
  csvContent?: string;

  @IsOptional()
  @IsArray()
  rows?: Record<string, any>[];
}
