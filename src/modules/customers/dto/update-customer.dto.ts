import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerTier } from '@prisma/client';

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  styleTags?: string;

  @IsOptional()
  @IsEnum(CustomerTier)
  tier?: CustomerTier;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  creditLimit?: number; // in standard PKR Rupees

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  styleNotes?: string;

  @IsOptional()
  @IsBoolean()
  acceptsPromotions?: boolean;

  @IsOptional()
  @IsBoolean()
  whatsappReceiptsOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
