import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CloseShiftDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  actualCash: number; // PKR Rupees counted in the physical cash drawer

  @IsOptional()
  @IsString()
  notes?: string;
}
