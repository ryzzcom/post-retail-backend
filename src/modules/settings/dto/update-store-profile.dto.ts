import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class UpdateStoreProfileDto {
  @IsOptional()
  @IsString()
  storeName?: string;

  @IsOptional()
  @IsString()
  branchCode?: string;

  @IsOptional()
  @IsString()
  tagline?: string;

  @IsOptional()
  @IsString()
  storeCategory?: string;

  @IsOptional()
  @IsString()
  primaryPhone?: string;

  @IsOptional()
  @IsString()
  whatsappNumber?: string;

  @IsOptional()
  @IsString()
  officialEmail?: string;

  @IsOptional()
  @IsString()
  streetAddress?: string;

  @IsOptional()
  @IsString()
  areaMarket?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  operatingHours?: string;

  @IsOptional()
  @IsString()
  ntnNumber?: string;

  @IsOptional()
  @IsString()
  strnNumber?: string;

  @IsOptional()
  @IsBoolean()
  fbrIntegrationEnabled?: boolean;

  @IsOptional()
  @IsString()
  posRegistrationId?: string;

  @IsOptional()
  @IsString()
  defaultGstRate?: string;
}
