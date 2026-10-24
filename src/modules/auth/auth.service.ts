import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@core/redis/redis.service';
import { MailService } from '@core/mail/mail.service';
import { SignupDto } from './dto/signup.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { LoginDto } from './dto/login.dto';
import { UnlockProfileDto } from './dto/unlock-profile.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { CreateCashierDto } from './dto/create-cashier.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
  ) {}

  private generateSlug(name: string): string {
    return (
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'store'
    );
  }

  /**
   * 1. Owner Signup (POST /api/v1/auth/signup)
   */
  async signup(dto: SignupDto) {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('Passwords do not match');
    }

    const email = dto.email.toLowerCase().trim();

    // Check if email is already taken
    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.isEmailVerified) {
        throw new ConflictException('An account with this email already exists. Please login.');
      }
      // If user exists but is unverified, regenerate OTP and update password
      const passwordHash = await bcrypt.hash(dto.password, 10);
      const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
      const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          fullName: dto.fullName.trim(),
          passwordHash,
          otpCode,
          otpExpiresAt,
        },
      });

      await this.mailService.sendVerificationOtp(email, otpCode);

      return {
        message: 'Registration pending verification. A fresh OTP has been sent to your email.',
        email,
      };
    }

    // Generate unique slug
    let baseSlug = this.generateSlug(dto.storeName);
    let slug = baseSlug;
    let counter = 1;
    while (await this.prisma.store.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${counter++}`;
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    await this.prisma.$transaction(async (tx) => {
      const store = await tx.store.create({
        data: {
          name: dto.storeName.trim(),
          code: slug,
          slug,
          currency: 'PKR',
        },
      });

      await tx.user.create({
        data: {
          storeId: store.id,
          email,
          fullName: dto.fullName.trim(),
          passwordHash,
          role: Role.OWNER,
          isEmailVerified: false,
          otpCode,
          otpExpiresAt,
        },
      });

      await tx.counter.create({
        data: {
          storeId: store.id,
          name: 'Counter 1',
          code: 'C-1',
        },
      });
    });

    // Dispatch verification OTP email
    await this.mailService.sendVerificationOtp(email, otpCode);

    return {
      message: 'Registration successful. Please verify OTP sent to your email.',
      email,
    };
  }

  /**
   * 2. Verify Signup OTP (POST /api/v1/auth/verify-otp)
   */
  async verifyOtp(dto: VerifyOtpDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        store: {
          include: {
            counters: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Account not found with this email');
    }

    if (user.isEmailVerified) {
      return { message: 'Account already verified. Please sign in.' };
    }

    if (!user.otpCode || user.otpCode !== dto.otp) {
      throw new BadRequestException('Invalid OTP code provided');
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('OTP code has expired. Please request a new one.');
    }

    // Auto-generate random 4-digit POS PIN
    const generatedPin = Math.floor(1000 + Math.random() * 9000).toString();
    const pinHash = await bcrypt.hash(generatedPin, 10);
    const defaultCounter = user.store.counters[0];

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          isEmailVerified: true,
          otpCode: null,
          otpExpiresAt: null,
        },
      });

      await tx.cashierProfile.create({
        data: {
          storeId: user.storeId,
          userId: user.id,
          displayName: user.fullName,
          pinHash,
          role: Role.OWNER,
          maxDiscountPct: 100,
          assignedCounterId: defaultCounter ? defaultCounter.id : null,
        },
      });
    });

    // Send the auto-generated 4-digit PIN to the Store Owner
    await this.mailService.sendPosSecurityPin(email, user.fullName, generatedPin);

    this.logger.log(`Account verified for ${user.email}. POS PIN generated and emailed.`);

    return {
      message: 'Account verified. POS PIN sent to email.',
    };
  }

  /**
   * 3. Resend OTP (POST /api/v1/auth/resend-otp)
   */
  async resendOtp(dto: ResendOtpDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('No account found with this email');
    }

    // Rate-limit check: minimum 60 seconds gap
    const rateLimitKey = `ratelimit:resend-otp:${email}`;
    const inCoolDown = await this.redisService.get(rateLimitKey);
    if (inCoolDown) {
      throw new HttpException(
        'Please wait 60 seconds before requesting another OTP',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpCode, otpExpiresAt },
    });

    // Enforce 60s cooldown in Redis
    await this.redisService.set(rateLimitKey, 'ACTIVE', 60);

    if (dto.type === 'SIGNUP') {
      await this.mailService.sendVerificationOtp(email, otpCode);
    } else {
      await this.mailService.sendPasswordResetOtp(email, otpCode);
    }

    return {
      message: 'New OTP sent to your email.',
    };
  }

  /**
   * 4. Store Sign In (POST /api/v1/auth/login)
   */
  async login(dto: LoginDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        store: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException('EMAIL_NOT_VERIFIED');
    }

    const expiresIn = dto.rememberMe ? '30d' : '7d';

    const payload = {
      sub: user.id,
      id: user.id,
      userId: user.id,
      storeId: user.storeId,
      role: user.role,
      email: user.email,
      fullName: user.fullName,
    };
    const accessToken = await this.jwtService.signAsync(payload, {
      expiresIn: expiresIn as any,
    });

    // Fetch active staff/cashier profiles for this store
    const profiles = await this.prisma.cashierProfile.findMany({
      where: {
        storeId: user.storeId,
        isActive: true,
      },
      select: {
        id: true,
        displayName: true,
        role: true,
        maxDiscountPct: true,
        assignedCounterId: true,
        assignedCounter: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return {
      accessToken,
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      store: {
        id: user.store.id,
        name: user.store.name,
        slug: user.store.slug,
      },
      profiles,
    };
  }

  /**
   * 5. Profile PIN Unlock / Select Profile (POST /api/v1/auth/profile/unlock)
   */
  async unlockProfile(storeId: string, dto: UnlockProfileDto) {
    const rateLimitKey = `ratelimit:pin-unlock:${dto.profileId}`;

    const rawAttempts = await this.redisService.get(rateLimitKey);
    const attempts = rawAttempts ? parseInt(rawAttempts, 10) : 0;

    if (attempts >= 5) {
      throw new HttpException(
        'Too many incorrect PIN attempts. Profile locked for 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const profile = await this.prisma.cashierProfile.findFirst({
      where: {
        id: dto.profileId,
        storeId,
        isActive: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const isMatch = await bcrypt.compare(dto.pin, profile.pinHash);
    if (!isMatch) {
      const nextAttempts = attempts + 1;
      await this.redisService.set(rateLimitKey, nextAttempts.toString(), 900); // 15 mins TTL

      const remaining = 5 - nextAttempts;
      throw new UnauthorizedException(
        remaining > 0
          ? `Invalid PIN. ${remaining} attempt(s) remaining.`
          : 'Invalid PIN. Profile locked for 15 minutes.',
      );
    }

    // Success: clear rate limiting
    await this.redisService.del(rateLimitKey);

    const landingPath = profile.role === Role.OWNER ? '/dashboard' : '/pos';

    return {
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        role: profile.role,
        maxDiscountPct: profile.maxDiscountPct,
      },
      landingPath,
    };
  }

  /**
   * 6. Change PIN (POST /api/v1/auth/change-pin)
   */
  async changePin(storeId: string, dto: ChangePinDto) {
    if (dto.newPin !== dto.confirmNewPin) {
      throw new BadRequestException('New PIN and confirmation PIN do not match');
    }

    const profile = await this.prisma.cashierProfile.findFirst({
      where: {
        id: dto.profileId,
        storeId,
        isActive: true,
      },
    });

    if (!profile) {
      throw new NotFoundException('Profile not found');
    }

    const isCurrentValid = await bcrypt.compare(dto.currentPin, profile.pinHash);
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current PIN is incorrect');
    }

    const newPinHash = await bcrypt.hash(dto.newPin, 10);

    await this.prisma.cashierProfile.update({
      where: { id: dto.profileId },
      data: { pinHash: newPinHash },
    });

    return {
      success: true,
      message: 'PIN changed successfully',
    };
  }

  /**
   * 7. Add Cashier Profile (POST /api/v1/auth/cashier)
   */
  async createCashier(storeId: string, dto: CreateCashierDto) {
    if (dto.pin !== dto.confirmPin) {
      throw new BadRequestException('PIN and confirmation PIN do not match');
    }

    const count = await this.prisma.cashierProfile.count({
      where: { storeId, isActive: true },
    });

    if (count >= 5) {
      throw new BadRequestException('Maximum of 5 profiles per store limit reached');
    }

    const pinHash = await bcrypt.hash(dto.pin, 10);

    const profile = await this.prisma.cashierProfile.create({
      data: {
        storeId,
        displayName: dto.displayName.trim(),
        pinHash,
        role: Role.CASHIER,
        maxDiscountPct: dto.maxDiscountPct ?? 10,
      },
    });

    return {
      success: true,
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        role: profile.role,
        maxDiscountPct: profile.maxDiscountPct,
      },
    };
  }

  /**
   * 8. Forgot Password Flow: Request OTP (POST /api/v1/auth/forgot-password)
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('No account found with this email');
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { otpCode, otpExpiresAt },
    });

    await this.mailService.sendPasswordResetOtp(email, otpCode);

    return {
      message: 'Password reset OTP sent to email.',
    };
  }

  /**
   * 9. Forgot Password Flow: Reset Password (POST /api/v1/auth/reset-password)
   */
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('New password and confirmation do not match');
    }

    const email = dto.email.toLowerCase().trim();

    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new NotFoundException('Account not found');
    }

    if (!user.otpCode || user.otpCode !== dto.otp) {
      throw new BadRequestException('Invalid OTP code');
    }

    if (!user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      throw new BadRequestException('OTP code has expired. Please request a new one.');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        otpCode: null,
        otpExpiresAt: null,
      },
    });

    return {
      message: 'Password reset successfully. You can now login with your new password.',
    };
  }

  /**
   * 10. Current User Profile (GET /api/v1/auth/me)
   */
  async getMe(userId: string, storeId?: string) {
    if (!userId) {
      throw new BadRequestException('User ID is required');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        storeId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const effectiveStoreId = storeId || user.storeId;
    const store = await this.prisma.store.findUnique({
      where: { id: effectiveStoreId },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!store) {
      throw new NotFoundException('Store context not found');
    }

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
      store,
    };
  }

  /**
   * 11. Logout (POST /api/v1/auth/logout)
   */
  async logout(token?: string, userId?: string) {
    if (token) {
      try {
        const decoded: any = this.jwtService.decode(token);
        let ttlSeconds = 7 * 24 * 60 * 60; // 7 days fallback
        if (decoded && decoded.exp) {
          const remainingSeconds = Math.floor(decoded.exp - Date.now() / 1000);
          if (remainingSeconds > 0) {
            ttlSeconds = remainingSeconds;
          }
        }
        await this.redisService.set(`blacklist:token:${token}`, 'REVOKED', ttlSeconds);
      } catch (err: any) {
        this.logger.warn(`Could not blacklist token in Redis: ${err.message}`);
      }
    }

    if (userId) {
      await this.redisService.del(`session:active-profile:${userId}`);
    }

    return {
      success: true,
      message: 'Logged out successfully',
    };
  }
}
