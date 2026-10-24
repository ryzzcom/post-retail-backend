import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CashierUnlockDto {
  @IsNotEmpty()
  @IsString()
  storeSlug: string;

  @IsNotEmpty()
  @IsString()
  counterId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$/, {
    message: 'PIN must be strictly 4 or 6 digits',
  })
  pin: string;
}
