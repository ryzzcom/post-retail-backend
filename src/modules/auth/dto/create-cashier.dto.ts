import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateCashierDto {
  @IsNotEmpty()
  @IsString()
  displayName: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, {
    message: 'PIN must be strictly 4 digits',
  })
  pin: string;

  @IsNotEmpty()
  @IsString()
  confirmPin: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maxDiscountPct?: number = 10;
}
