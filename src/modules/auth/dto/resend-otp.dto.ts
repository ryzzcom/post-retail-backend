import { IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsString()
  @IsIn(['SIGNUP', 'FORGOT_PASSWORD'], {
    message: 'type must be either SIGNUP or FORGOT_PASSWORD',
  })
  type: 'SIGNUP' | 'FORGOT_PASSWORD';
}
