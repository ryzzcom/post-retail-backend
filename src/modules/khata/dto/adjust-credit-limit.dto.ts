import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class AdjustCreditLimitDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  creditLimit?: number; // PKR Rupees

  @IsOptional()
  @IsNumber()
  @Min(0)
  newCreditLimit?: number; // PKR Rupees

  @IsOptional()
  @IsString()
  reason?: string;
}
