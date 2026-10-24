import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedUser } from '@core/decorators/current-user.decorator';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'super_secret_jwt_key_change_in_production',
      ),
    });
  }

  async validate(payload: any): Promise<AuthenticatedUser> {
    const id = payload.sub || payload.id;
    if (!id) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      id,
      userId: id,
      storeId: payload.storeId,
      role: payload.role,
      email: payload.email,
      fullName: payload.fullName,
    };
  }
}
