import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordKhataPaymentDto {
  @IsNotEmpty()
  @IsString()
  customerId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number; // PKR Rupees

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
