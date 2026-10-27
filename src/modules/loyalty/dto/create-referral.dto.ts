import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateReferralDto {
  @IsNotEmpty()
  @IsString()
  referrerCustomerId: string;

  @IsNotEmpty()
  @IsString()
  refereeName: string;

  @IsOptional()
  @IsString()
  refereePhone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  bonusPoints?: number;
}
