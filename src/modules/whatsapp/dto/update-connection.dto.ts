import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateConnectionSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  phoneNumberId?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  businessDisplayName?: string;

  @IsOptional()
  @IsString()
  googleReviewLink?: string;

  @IsOptional()
  @IsBoolean()
  isApiEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  requireExplicitOptIn?: boolean;

  @IsOptional()
  @IsBoolean()
  enforceQuietHours?: boolean;

  @IsOptional()
  @IsBoolean()
  autoUnsubscribeKeyword?: boolean;
}
