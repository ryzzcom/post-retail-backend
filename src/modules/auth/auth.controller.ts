import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { LoginDto } from './dto/login.dto';
import { UnlockProfileDto } from './dto/unlock-profile.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '@core/decorators/public.decorator';
import { CurrentTenant } from '@core/decorators/current-tenant.decorator';
import { CurrentUser } from '@core/decorators/current-user.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@prisma/client';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 1. Owner Signup (POST /api/v1/auth/signup)
   */
  @Public()
  @Post(['signup', 'owner/signup'])
  async signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  /**
   * 2. Verify Signup OTP (POST /api/v1/auth/verify-otp)
   */
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  /**
   * 3. Resend OTP (POST /api/v1/auth/resend-otp)
   */
  @Public()
  @Post('resend-otp')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto) {
    return this.authService.resendOtp(dto);
  }

  /**
   * 4. Store Sign In (POST /api/v1/auth/login)
   */
  @Public()
  @Post(['login', 'owner/login'])
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * 5. Profile PIN Unlock / Select Profile (POST /api/v1/auth/profile/unlock)
   */
  @Post('profile/unlock')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async unlockProfile(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: UnlockProfileDto,
  ) {
    return this.authService.unlockProfile(storeId, dto);
  }

  /**
   * 6. Change PIN (POST /api/v1/auth/change-pin)
   */
  @Post('change-pin')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePin(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: ChangePinDto,
  ) {
    return this.authService.changePin(storeId, dto);
  }

  /**
   * 7. Add Cashier Profile (POST /api/v1/auth/cashier)
   */
  @Post('cashier')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.OWNER)
  @HttpCode(HttpStatus.CREATED)
  async createCashier(
    @CurrentTenant('storeId') storeId: string,
    @Body() dto: CreateCashierDto,
  ) {
    return this.authService.createCashier(storeId, dto);
  }

  /**
   * 8. Forgot Password: Request OTP (POST /api/v1/auth/forgot-password)
   */
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  /**
   * 9. Forgot Password: Reset Password (POST /api/v1/auth/reset-password)
   */
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  /**
   * 10. Current User Profile (GET /api/v1/auth/me)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getMe(
    @CurrentUser('id') userId: string,
    @CurrentTenant('storeId') storeId: string,
  ) {
    return this.authService.getMe(userId, storeId);
  }

  /**
   * 11. Logout (POST /api/v1/auth/logout)
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @CurrentUser('id') userId: string,
  ) {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;
    return this.authService.logout(token, userId);
  }
}
