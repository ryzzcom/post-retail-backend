import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class UnlockProfileDto {
  @IsNotEmpty()
  @IsString()
  profileId: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, {
    message: 'PIN must be strictly 4 digits',
  })
  pin: string;
}
