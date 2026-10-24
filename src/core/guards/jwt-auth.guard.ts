import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '@core/decorators/public.decorator';
import { AuthenticatedUser } from '@core/decorators/current-user.decorator';
import { RedisService } from '@core/redis/redis.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Authentication token is missing');
    }

    if (this.redisService) {
      const isBlacklisted = await this.redisService.get(`blacklist:token:${token}`);
      if (isBlacklisted) {
        throw new UnauthorizedException('Authentication token has been revoked');
      }
    }

    let payload: any;
    try {
      const secret = this.configService.get<string>(
        'JWT_SECRET',
        'super_secret_jwt_key_change_in_production',
      );
      payload = await this.jwtService.verifyAsync<any>(token, {
        secret,
      });

      const userId = payload.sub || payload.id || payload.userId;
      if (!userId) {
        throw new UnauthorizedException('Authentication token missing user identification');
      }

      const user: AuthenticatedUser = {
        ...payload,
        id: userId,
        userId: userId,
        sub: userId,
        storeId: payload.storeId,
        role: payload.role,
        email: payload.email,
        fullName: payload.fullName,
      };

      // Attach user payload to request for downstream decorators & guards
      (request as any).user = user;
    } catch {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    // Mandatory PIN setup policy: If PIN is not set, block subsequent business routes with 403
    const isAuthRoute = request.originalUrl
      ? request.originalUrl.includes('/api/v1/auth/')
      : request.url.includes('/api/v1/auth/');

    if (!isAuthRoute && payload.isPinSet === false) {
      throw new ForbiddenException('PIN_SETUP_REQUIRED');
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
