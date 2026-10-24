import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class OpenShiftDto {
  @IsNotEmpty()
  @IsString()
  counterId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  openingFloat: number; // PKR Rupees

  @IsOptional()
  @IsString()
  notes?: string;
}
