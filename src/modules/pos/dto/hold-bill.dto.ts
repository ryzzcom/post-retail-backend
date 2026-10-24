import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class HoldBillDto {
  @IsNotEmpty()
  @IsString()
  counterId: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  referenceNote?: string;

  @IsNotEmpty()
  @IsObject()
  billData: Record<string, any>;
}
