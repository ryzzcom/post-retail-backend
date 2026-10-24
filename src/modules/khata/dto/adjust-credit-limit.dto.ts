import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AdjustCreditLimitDto {
  @IsNotEmpty()
  @IsString()
  customerId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  newCreditLimit: number; // PKR Rupees

  @IsOptional()
  @IsString()
  reason?: string;
}
