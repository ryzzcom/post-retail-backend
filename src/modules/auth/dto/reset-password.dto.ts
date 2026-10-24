import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Length,
  MinLength,
} from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword: string;

  @IsNotEmpty()
  @IsString()
  confirmNewPassword: string;
}
