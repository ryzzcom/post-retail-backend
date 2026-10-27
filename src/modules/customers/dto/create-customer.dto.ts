import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerTier } from '@prisma/client';

export class CreateCustomerDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsNotEmpty()
  @IsString()
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  styleTags?: string;

  @IsOptional()
  @IsEnum(CustomerTier)
  tier?: CustomerTier = CustomerTier.REGULAR;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  creditLimit: number = 50000; // in standard PKR Rupees (default Rs. 50,000)

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  openingKhataBalance: number = 0; // in standard PKR Rupees

  @IsOptional()
  @IsString()
  city?: string = 'Lahore';

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  styleNotes?: string;

  @IsOptional()
  @IsBoolean()
  acceptsPromotions: boolean = true;

  @IsOptional()
  @IsBoolean()
  whatsappReceiptsOptIn: boolean = true;
}
