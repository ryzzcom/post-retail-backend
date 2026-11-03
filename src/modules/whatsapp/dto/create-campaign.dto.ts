import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCampaignDto {
  @IsNotEmpty()
  @IsString()
  @MinLength(3)
  title: string;

  @IsNotEmpty()
  @IsString()
  purpose: string;

  @IsNotEmpty()
  @IsString()
  audienceSegment: string; // e.g. "All Opted-in", "Gold Tier", "Silver Tier", "Inactive > 60 days"

  @IsOptional()
  @IsString()
  couponCode?: string;

  @IsOptional()
  @IsString()
  discount?: string;

  @IsOptional()
  @IsString()
  validity?: string;

  @IsOptional()
  @IsString()
  templateName?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsIn(['now', 'scheduled', 'NOW', 'SCHEDULED'])
  scheduleType?: string = 'now';

  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  customNote?: string;
}
