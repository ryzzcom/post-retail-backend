import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SetupPinDto {
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$|^\d{6}$/, {
    message: 'PIN must be strictly 4 or 6 digits',
  })
  pin: string;
}
