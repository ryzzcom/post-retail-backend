import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';
import { RedisService } from '@core/redis/redis.service';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);
  private readonly DEFAULT_TTL = 3600; // 1 hour cache for idempotent results

  constructor(private readonly redisService: RedisService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKey = request.headers['x-idempotency-key'] as string;

    if (!idempotencyKey) {
      return next.handle();
    }

    const storeId = (request as any).user?.storeId || request.headers['x-store-id'] || 'global';
    const redisKey = `idempotency:${storeId}:${idempotencyKey}`;

    // Check if response is already cached
    const cachedResponse = await this.redisService.get(redisKey);
    if (cachedResponse) {
      this.logger.log(`Serving cached idempotent response for key: ${idempotencyKey}`);
      try {
        return of(JSON.parse(cachedResponse));
      } catch {
        return of(cachedResponse);
      }
    }

    // Attempt to acquire lock for in-flight execution
    const lockKey = `${redisKey}:lock`;
    const acquired = await this.redisService.setNx(lockKey, 'IN_FLIGHT', 30);
    if (!acquired) {
      throw new ConflictException(
        'A request with this idempotency key is currently being processed. Please retry shortly.',
      );
    }

    return next.handle().pipe(
      tap({
        next: async (data) => {
          await this.redisService.set(redisKey, JSON.stringify(data), this.DEFAULT_TTL);
          await this.redisService.del(lockKey);
        },
        error: async () => {
          await this.redisService.del(lockKey);
        },
      }),
    );
  }
}
