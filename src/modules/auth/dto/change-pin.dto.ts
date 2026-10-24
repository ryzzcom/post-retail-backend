import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class ChangePinDto {
  @IsNotEmpty()
  @IsString()
  profileId: string;

  @IsNotEmpty()
  @IsString()
  currentPin: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}$/, {
    message: 'New PIN must be strictly 4 digits',
  })
  newPin: string;

  @IsNotEmpty()
  @IsString()
  confirmNewPin: string;
}
