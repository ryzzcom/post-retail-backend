import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RecordKhataPaymentDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  amount: number; // PKR Rupees

  @IsOptional()
  @IsString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string; // cash, bank_transfer, card, etc.

  @IsOptional()
  @IsString()
  referenceNo?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
